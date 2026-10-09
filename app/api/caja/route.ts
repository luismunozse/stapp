import { NextResponse } from "next/server"
import { requireCajaAccess } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { fetchMovimientosDia, computeTotales } from "@/lib/caja-utils"
import { sucursalParaLectura } from "@/lib/sucursal"
import { todayInTimeZone, dayRangeUtc, DEFAULT_TIMEZONE } from "@/lib/timezone"

const PAGE = 1000
const LOTE = 100
const TOP = 10
const LOTES_EN_PARALELO = 5

type Fila = Record<string, any>

// Lee todas las filas de una consulta paginando de a 1000 (PostgREST trunca sin
// error). Orden estable por id; cualquier error lanza.
// TODO: reemplazar por fetchAllRows (lib/fetch-all-rows.ts) cuando entre #429.
async function leerTodo(armar: () => any): Promise<Fila[]> {
  const filas: Fila[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await armar().order("id", { ascending: true }).range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    filas.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return filas
}

// Órdenes reparadas/entregadas con cobro pendiente que de verdad deben plata:
//  - Se excluyen las que ya tienen un CARGO a cuenta corriente (fiado, revertido o
//    no: misma regla que get_deuda_cliente_sucursal, mig 318, y que
//    clientes/[id]/ordenes-pendientes): la deuda vive en la cuenta del cliente.
//  - Se excluyen las que tienen una factura PAGADO: la factura se cobra por
//    pagos_parciales y no sincroniza ordenes_servicio.estado_cobro (ver
//    app/api/pagos/route.ts), que queda en PENDIENTE.
// El conteo es exacto sobre lo que queda y se muestran las 10 más nuevas.
async function cargarSinCobrar(organizationId: string, sucursalId: string | null) {
  const candidatas = await leerTodo(() => {
    let q = supabaseAdmin
      .from("ordenes_servicio")
      .select("id, numero_orden, costo_final, total_cobrado, descuento_cobro")
      .eq("organization_id", organizationId)
      .in("estado", ["REPARADO", "ENTREGADO"])
      .in("estado_cobro", ["PENDIENTE", "PARCIAL"])
      .not("costo_final", "is", null)
      .gt("costo_final", 0)
      // ordenes_servicio no tiene created_at: la fecha de alta es fecha_ingreso.
      .order("fecha_ingreso", { ascending: false, nullsFirst: false })
    if (sucursalId) q = q.eq("sucursal_id", sucursalId)
    return q
  })

  // Pendiente real, igual que get_deuda_cliente_sucursal (mig 318) y
  // clientes/[id]/ordenes-pendientes: costo - descuento - cobrado, con piso en 0
  // (descuento_cobro null = sin descuento). Una orden sin saldo no es "sin cobrar".
  const conSaldo = candidatas
    .map((o) => {
      const costo = parseFloat(o.costo_final || "0")
      const descuento = parseFloat(o.descuento_cobro || "0")
      const cobrado = parseFloat(o.total_cobrado || "0")
      return { o, costo, cobrado, pendiente: Math.max(costo - descuento - cobrado, 0) }
    })
    .filter((x) => x.pendiente > 0)

  // Lotes chicos en el .in(): una org llega a cientos de candidatas y la URL
  // de PostgREST tiene tope de largo. Hasta LOTES_EN_PARALELO lotes a la vez; si
  // cualquiera falla, Promise.all rechaza y no se devuelve un conteo parcial.
  const lotes: string[][] = []
  for (let i = 0; i < conSaldo.length; i += LOTE) {
    lotes.push(conSaldo.slice(i, i + LOTE).map((x) => x.o.id))
  }
  const excluidas = new Set<string>()
  let siguiente = 0
  const trabajador = async () => {
    while (siguiente < lotes.length) {
      const ids = lotes[siguiente++]
      const [cargos, facturas] = await Promise.all([
        leerTodo(() =>
          supabaseAdmin
            .from("cuenta_corriente")
            .select("referencia_id")
            .eq("organization_id", organizationId)
            .eq("tipo", "CARGO")
            .eq("referencia_tipo", "ORDEN")
            .in("referencia_id", ids)
        ),
        leerTodo(() =>
          supabaseAdmin.from("facturas").select("orden_id").eq("estado_pago", "PAGADO").in("orden_id", ids)
        ),
      ])
      for (const c of cargos) excluidas.add(c.referencia_id)
      for (const f of facturas) excluidas.add(f.orden_id)
    }
  }
  await Promise.all(Array.from({ length: Math.min(LOTES_EN_PARALELO, lotes.length) }, trabajador))

  const pendientes = conSaldo.filter((x) => !excluidas.has(x.o.id))
  return {
    count: pendientes.length,
    ordenes: pendientes.slice(0, TOP).map(({ o, costo, cobrado, pendiente }) => ({
      id: o.id,
      numeroOrden: o.numero_orden,
      costoFinal: costo,
      totalCobrado: cobrado,
      pendiente,
    })),
  }
}

export async function GET(request: Request) {
  try {
    // Los totales del día son de quien opera la caja. Con requireAuth()
    // cualquier rol autenticado que pegara acá —o escribiera /caja en la
    // URL— leía la facturación del día de toda la organización.
    const { error, session, role, organizationId } = await requireCajaAccess()
    if (error) return error

    const filtro = await sucursalParaLectura({
      role: role ?? null,
      userSucursalId: session!.user.sucursalId ?? null,
    })
    const sid = filtro.verTodas ? null : filtro.sucursalId

    // Día de caja = día calendario de la ORG (no de UTC): las ventas de
    // 21:00-24:00 locales en UTC-3 pertenecen al día local, no al de UTC.
    const { data: orgTz } = await supabaseAdmin
      .from("organizations")
      .select("zona_horaria")
      .eq("id", organizationId!)
      .single()
    const tz = orgTz?.zona_horaria || DEFAULT_TIMEZONE

    const { searchParams } = new URL(request.url)
    const fecha = searchParams.get("fecha") || todayInTimeZone(tz)
    const { desde: fechaDesde, hasta: fechaHasta } = dayRangeUtc(fecha, tz)
    const metodoPago = searchParams.get("metodoPago") || undefined
    const tipo = searchParams.get("tipo") || undefined

    // Obtener movimientos unificados (incluye manuales)
    const movimientos = await fetchMovimientosDia(
      organizationId!,
      fechaDesde,
      fechaHasta,
      { metodoPago, tipo },
      sid
    )

    const totales = computeTotales(movimientos)

    // Órdenes reparadas sin cobrar. Una consulta fallida NO es "0 sin cobrar": se
    // loguea y la tarjeta queda como no disponible (null) sin tumbar el resto de la caja.
    let sinCobrar: Awaited<ReturnType<typeof cargarSinCobrar>> | null = null
    try {
      sinCobrar = await cargarSinCobrar(organizationId!, sid)
    } catch (sinCobrarError) {
      console.error("Error fetching caja sinCobrar:", sinCobrarError)
    }

    // Sesión actual
    let sesionQuery = supabaseAdmin
      .from("sesiones_caja")
      .select("id, saldo_inicial, opened_at, estado, usuario_apertura_id")
      .eq("organization_id", organizationId!)
      .eq("estado", "ABIERTA")
    if (sid) sesionQuery = sesionQuery.eq("sucursal_id", sid)
    const { data: sesionActual } = await sesionQuery.maybeSingle()

    let sesionConUsuario = null
    if (sesionActual) {
      const { data: usuario } = await supabaseAdmin
        .from("users")
        .select("id, nombre")
        .eq("id", sesionActual.usuario_apertura_id)
        .single()

      sesionConUsuario = {
        id: sesionActual.id,
        saldoInicial: parseFloat(sesionActual.saldo_inicial || "0"),
        openedAt: sesionActual.opened_at,
        usuarioApertura: usuario ? { id: usuario.id, nombre: usuario.nombre } : null,
      }
    }

    return NextResponse.json({
      fecha,
      ...totales,
      movimientos,
      sinCobrar,
      sesionActual: sesionConUsuario,
    })
  } catch (err) {
    console.error("Error fetching caja:", err)
    return NextResponse.json({ error: "Error al obtener caja diaria" }, { status: 500 })
  }
}
