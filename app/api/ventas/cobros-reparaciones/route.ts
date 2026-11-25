import { NextResponse } from "next/server"
import { requirePosAccess, soloVeSusVentas } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaLectura } from "@/lib/sucursal"
import { terminoDeBusquedaSeguro } from "@/lib/sucursal-ordenes"
import { DEFAULT_TIMEZONE, dayRangeUtc } from "@/lib/timezone"
import { reportarError } from "@/lib/api-error"

const METODOS_PAGO = new Set([
  "EFECTIVO", "TRANSFERENCIA", "TARJETA", "TARJETA_DEBITO", "TARJETA_CREDITO",
  "MERCADOPAGO", "CUENTA_CORRIENTE", "OTRO",
])

// Tope de órdenes que una búsqueda puede resolver: los ids viajan en un
// `in.(...)` de la URL de PostgREST, que tiene largo máximo.
const MAX_ORDENES_EN_BUSQUEDA = 200
const MAX_CLIENTES_EN_BUSQUEDA = 100

/**
 * GET — Cobros de órdenes de reparación, para la pestaña "Reparaciones" de Ventas.
 *
 * Un cobro de orden no es una venta: vive en `cobros_orden`, no en `ventas`, y
 * por eso el listado de ventas nunca lo mostró. Esta ruta los lista con el
 * mismo alcance que ese listado: entra quien tiene acceso al POS, y solo el
 * ADMIN ve los cobros que registró otro.
 */
export async function GET(request: Request) {
  try {
    const { error, organizationId, userId, role, session } = await requirePosAccess()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const search = (searchParams.get("search") || "").trim()
    const metodo = searchParams.get("metodo") || ""
    const fechaDesde = searchParams.get("fechaDesde") || ""
    const fechaHasta = searchParams.get("fechaHasta") || ""

    const page = Math.max(1, parseInt(searchParams.get("page") || "1") || 1)
    const limit = Math.min(Math.max(1, parseInt(searchParams.get("limit") || "20") || 20), 100)
    const offset = (page - 1) * limit

    // La búsqueda es por datos de la orden (código, número, cliente), que están
    // a dos tablas de distancia: se resuelven primero las órdenes que coinciden.
    let ordenIds: string[] | null = null
    if (search) {
      ordenIds = await ordenesQueCoinciden(organizationId!, search)
      if (ordenIds.length === 0) {
        return NextResponse.json({ data: [], total: 0, page, limit })
      }
    }

    let query = supabaseAdmin
      .from("cobros_orden")
      .select(`
        id, monto, metodo_pago, numero_referencia, cuotas, created_at, anulado, orden_id,
        users:usuario_id (id, nombre),
        ordenes_servicio!inner (
          id, numero_orden, codigo_orden, dispositivo, marca, sucursal_id,
          clientes (nombre)
        )
      `, { count: "exact" })
      .eq("organization_id", organizationId!)
      .order("created_at", { ascending: false })

    if (soloVeSusVentas(role)) {
      query = query.eq("usuario_id", userId!)
    }

    const filtro = await sucursalParaLectura({ role, userSucursalId: session!.user.sucursalId ?? null })
    if (!filtro.verTodas && filtro.sucursalId) {
      query = query.eq("ordenes_servicio.sucursal_id", filtro.sucursalId)
    }

    if (METODOS_PAGO.has(metodo)) {
      query = query.eq("metodo_pago", metodo)
    }

    // Fechas: días de la organización, no días UTC (mismo criterio que /api/ventas).
    if (fechaDesde || fechaHasta) {
      const { data: org } = await supabaseAdmin
        .from("organizations")
        .select("zona_horaria")
        .eq("id", organizationId!)
        .single()
      const tz: string = org?.zona_horaria || DEFAULT_TIMEZONE
      const esDia = (f: string) => /^\d{4}-\d{2}-\d{2}$/.test(f)
      if (fechaDesde) {
        query = query.gte("created_at", esDia(fechaDesde) ? dayRangeUtc(fechaDesde, tz).desde : fechaDesde)
      }
      if (fechaHasta) {
        query = query.lte("created_at", esDia(fechaHasta) ? dayRangeUtc(fechaHasta, tz).hasta : fechaHasta)
      }
    }

    if (ordenIds) {
      query = query.in("orden_id", ordenIds)
    }

    const { data: cobros, error: dbError, count } = await query.range(offset, offset + limit - 1)
    if (dbError) throw dbError

    return NextResponse.json({
      data: (cobros || []).map(formatCobro),
      total: count || 0,
      page,
      limit,
    })
  } catch (err) {
    console.error("Error fetching cobros de reparaciones:", err)
    reportarError(err, { ruta: "/api/ventas/cobros-reparaciones" })
    return NextResponse.json({ error: "Error al obtener los cobros de reparaciones" }, { status: 500 })
  }
}

async function ordenesQueCoinciden(organizationId: string, search: string): Promise<string[]> {
  const termino = terminoDeBusquedaSeguro(search)

  const { data: clientesMatch } = await supabaseAdmin
    .from("clientes")
    .select("id")
    .eq("organization_id", organizationId)
    .ilike("nombre", `%${termino}%`)
    .order("id", { ascending: false })
    .limit(MAX_CLIENTES_EN_BUSQUEDA)
  const clienteIds = (clientesMatch || []).map((c: { id: string }) => c.id)

  const filters = [`codigo_orden.ilike.%${termino}%`]
  const numero = parseInt(search, 10)
  if (/^\d+$/.test(search) && numero <= 2147483647) {
    filters.push(`numero_orden.eq.${numero}`)
  }
  if (clienteIds.length > 0) {
    filters.push(`cliente_id.in.(${clienteIds.join(",")})`)
  }

  const { data: ordenes } = await supabaseAdmin
    .from("ordenes_servicio")
    .select("id")
    .eq("organization_id", organizationId)
    .or(filters.join(","))
    .order("fecha_ingreso", { ascending: false })
    .limit(MAX_ORDENES_EN_BUSQUEDA)

  return (ordenes || []).map((o: { id: string }) => o.id)
}

function formatCobro(c: any) {
  const orden = c.ordenes_servicio
  return {
    id: c.id,
    monto: parseFloat(c.monto),
    metodoPago: c.metodo_pago,
    referencia: c.numero_referencia ?? null,
    cuotas: c.cuotas ?? null,
    fecha: c.created_at,
    anulado: c.anulado === true,
    cobradoPor: c.users?.nombre ?? null,
    orden: {
      id: orden?.id ?? c.orden_id,
      codigo: orden?.codigo_orden ?? null,
      numeroOrden: orden?.numero_orden ?? null,
      equipo: [orden?.marca, orden?.dispositivo].filter(Boolean).join(" ") || null,
      clienteNombre: orden?.clientes?.nombre ?? null,
    },
  }
}
