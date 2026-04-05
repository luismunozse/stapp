import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { fetchMovimientosDia, computeTotales } from "@/lib/caja-utils"

export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const fecha = searchParams.get("fecha") || new Date().toISOString().split("T")[0]
    const fechaDesde = `${fecha}T00:00:00`
    const fechaHasta = `${fecha}T23:59:59`
    const metodoPago = searchParams.get("metodoPago") || undefined
    const tipo = searchParams.get("tipo") || undefined

    // Obtener movimientos unificados (incluye manuales)
    const movimientos = await fetchMovimientosDia(
      organizationId!,
      fechaDesde,
      fechaHasta,
      { metodoPago, tipo }
    )

    const totales = computeTotales(movimientos)

    // Órdenes reparadas sin cobrar
    const { data: sinCobrar, count: sinCobrarCount } = await supabaseAdmin
      .from("ordenes_servicio")
      .select("id, numero_orden, costo_final, total_cobrado, estado_cobro", { count: "exact" })
      .eq("organization_id", organizationId!)
      .in("estado", ["REPARADO", "ENTREGADO"])
      .in("estado_cobro", ["PENDIENTE", "PARCIAL"])
      .not("costo_final", "is", null)
      .gt("costo_final", 0)
      .order("created_at", { ascending: false })
      .limit(10)

    // Sesión actual
    const { data: sesionActual } = await supabaseAdmin
      .from("sesiones_caja")
      .select("id, saldo_inicial, opened_at, estado, usuario_apertura_id")
      .eq("organization_id", organizationId!)
      .eq("estado", "ABIERTA")
      .maybeSingle()

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
