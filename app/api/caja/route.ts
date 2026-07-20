import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { fetchMovimientosDia, computeTotales } from "@/lib/caja-utils"
import { sucursalParaLectura } from "@/lib/sucursal"
import { todayInTimeZone, dayRangeUtc, DEFAULT_TIMEZONE } from "@/lib/timezone"

export async function GET(request: Request) {
  try {
    const { error, session, role, organizationId } = await requireAuth()
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

    // Órdenes reparadas sin cobrar
    let sinCobrarQuery = supabaseAdmin
      .from("ordenes_servicio")
      .select("id, numero_orden, costo_final, total_cobrado, estado_cobro", { count: "exact" })
      .eq("organization_id", organizationId!)
      .in("estado", ["REPARADO", "ENTREGADO"])
      .in("estado_cobro", ["PENDIENTE", "PARCIAL"])
      .not("costo_final", "is", null)
      .gt("costo_final", 0)
      .order("created_at", { ascending: false })
      .limit(10)
    if (sid) sinCobrarQuery = sinCobrarQuery.eq("sucursal_id", sid)
    const { data: sinCobrar, count: sinCobrarCount } = await sinCobrarQuery

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
      sinCobrar: {
        count: sinCobrarCount || 0,
        ordenes: (sinCobrar || []).map((o) => ({
          id: o.id,
          numeroOrden: o.numero_orden,
          costoFinal: parseFloat(o.costo_final || "0"),
          totalCobrado: parseFloat(o.total_cobrado || "0"),
          pendiente: parseFloat(o.costo_final || "0") - parseFloat(o.total_cobrado || "0"),
        })),
      },
      sesionActual: sesionConUsuario,
    })
  } catch (err) {
    console.error("Error fetching caja:", err)
    return NextResponse.json({ error: "Error al obtener caja diaria" }, { status: 500 })
  }
}
