import { NextResponse } from "next/server"
import { requireCajaAccess } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaEscritura, sucursalParaLectura } from "@/lib/sucursal"
import { esMovimientoCogsAutomatico } from "@/lib/caja-utils"
import { todayInTimeZone, dayRangeUtc, DEFAULT_TIMEZONE } from "@/lib/timezone"
import { z } from "zod"

const movimientoSchema = z.object({
  tipo: z.enum(["INGRESO", "EGRESO"]),
  monto: z.number().positive("El monto debe ser mayor a 0"),
  metodoPago: z.string().min(1, "El método de pago es requerido"),
  concepto: z.string().min(1, "El concepto es requerido"),
  observaciones: z.string().optional(),
  categoriaGastoId: z.string().nullable().optional(),
  afectaRentabilidad: z.boolean().optional(),
  comprobanteUrl: z.string().url().nullable().optional(),
})

// GET - Lista movimientos manuales del día
export async function GET(request: Request) {
  try {
    const { error, organizationId, role, session } = await requireCajaAccess()
    if (error) return error

    const filtro = await sucursalParaLectura({ role, userSucursalId: session!.user.sucursalId ?? null })

    // Día de caja = día calendario de la ORG (no de UTC).
    const { data: orgTz } = await supabaseAdmin
      .from("organizations")
      .select("zona_horaria")
      .eq("id", organizationId!)
      .single()
    const tz = orgTz?.zona_horaria || DEFAULT_TIMEZONE

    const { searchParams } = new URL(request.url)
    const fecha = searchParams.get("fecha") || todayInTimeZone(tz)
    const { desde: fechaDesde, hasta: fechaHasta } = dayRangeUtc(fecha, tz)

    let movimientosQuery = supabaseAdmin
      .from("movimientos_caja")
      .select("*, users(id, nombre), categorias_gasto(id, nombre, color, icono)")
      .eq("organization_id", organizationId!)
      .gte("fecha", fechaDesde)
      .lte("fecha", fechaHasta)
      .order("fecha", { ascending: false })

    if (!filtro.verTodas && filtro.sucursalId) {
      movimientosQuery = movimientosQuery.eq("sucursal_id", filtro.sucursalId)
    }

    const { data: movimientos } = await movimientosQuery

    return NextResponse.json({
      movimientos: (movimientos || [])
        // El egreso automático de COGS es contable, no un movimiento de caja real.
        .filter((m) => !esMovimientoCogsAutomatico(m))
        .map((m) => ({
        id: m.id,
        tipo: m.tipo,
        monto: parseFloat(m.monto),
        metodoPago: m.metodo_pago,
        concepto: m.concepto,
        observaciones: m.observaciones,
        usuarioId: m.usuario_id,
        usuarioNombre: m.users?.nombre || null,
        fecha: m.fecha,
        categoriaGastoId: m.categoria_gasto_id,
        categoria: m.categorias_gasto
          ? {
              id: m.categorias_gasto.id,
              nombre: m.categorias_gasto.nombre,
              color: m.categorias_gasto.color,
              icono: m.categorias_gasto.icono,
            }
          : null,
        afectaRentabilidad: m.afecta_rentabilidad,
        comprobanteUrl: m.comprobante_url,
        esRecurrente: m.es_recurrente,
      })),
    })
  } catch (err) {
    console.error("Error fetching movimientos:", err)
    return NextResponse.json({ error: "Error al obtener movimientos" }, { status: 500 })
  }
}

// POST - Crear movimiento manual
export async function POST(request: Request) {
  try {
    const { error, organizationId, userId, role, session } = await requireCajaAccess()
    if (error) return error

    const body = await request.json()
    const parsed = movimientoSchema.parse(body)

    const sucursalId = await sucursalParaEscritura({
      role,
      organizationId: organizationId!,
      userSucursalId: session!.user.sucursalId ?? null,
    })

    // Buscar sesión abierta (opcional), scoped a la misma sucursal del movimiento
    // para no enlazarlo a la sesión de otra sucursal cuando hay varias abiertas.
    let sesionQuery = supabaseAdmin
      .from("sesiones_caja")
      .select("id")
      .eq("organization_id", organizationId!)
      .eq("estado", "ABIERTA")
    if (sucursalId) sesionQuery = sesionQuery.eq("sucursal_id", sucursalId)
    const { data: sesionAbierta } = await sesionQuery.maybeSingle()

    // Si vino categoriaGastoId pero no afectaRentabilidad explícito, heredar de la categoría
    let afectaRentabilidad = parsed.afectaRentabilidad
    if (parsed.categoriaGastoId && afectaRentabilidad === undefined) {
      const { data: cat } = await supabaseAdmin
        .from("categorias_gasto")
        .select("afecta_rentabilidad")
        .eq("id", parsed.categoriaGastoId)
        .eq("organization_id", organizationId!)
        .maybeSingle()
      if (cat) afectaRentabilidad = cat.afecta_rentabilidad
    }

    const { data: movimiento, error: insertError } = await supabaseAdmin
      .from("movimientos_caja")
      .insert({
        organization_id: organizationId!,
        sucursal_id: sucursalId,
        sesion_caja_id: sesionAbierta?.id || null,
        tipo: parsed.tipo,
        monto: parsed.monto,
        metodo_pago: parsed.metodoPago,
        concepto: parsed.concepto,
        observaciones: parsed.observaciones || null,
        usuario_id: userId!,
        categoria_gasto_id: parsed.categoriaGastoId || null,
        afecta_rentabilidad: afectaRentabilidad ?? true,
        comprobante_url: parsed.comprobanteUrl || null,
      })
      .select("*")
      .single()

    if (insertError) {
      console.error("Error creating movimiento:", insertError)
      return NextResponse.json({ error: "Error al crear movimiento" }, { status: 500 })
    }

    return NextResponse.json({ movimiento }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error creating movimiento:", err)
    return NextResponse.json({ error: "Error al crear movimiento" }, { status: 500 })
  }
}
