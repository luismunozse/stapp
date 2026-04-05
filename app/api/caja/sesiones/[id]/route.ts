import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { fetchMovimientosDia, computeTotales } from "@/lib/caja-utils"

// GET - Detalle completo de una sesión
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id } = await params

    const { data: sesion } = await supabaseAdmin
      .from("sesiones_caja")
      .select(`
        *,
        usuario_apertura:users!sesiones_caja_usuario_apertura_id_fkey(id, nombre),
        usuario_cierre:users!sesiones_caja_usuario_cierre_id_fkey(id, nombre)
      `)
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (!sesion) {
      return NextResponse.json({ error: "Sesión no encontrada" }, { status: 404 })
    }

    // Obtener movimientos del período de la sesión
    const fechaDesde = sesion.opened_at
    const fechaHasta = sesion.closed_at || new Date().toISOString()

    const movimientos = await fetchMovimientosDia(organizationId!, fechaDesde, fechaHasta)
    const totales = computeTotales(movimientos)

    return NextResponse.json({
      sesion: {
        id: sesion.id,
        estado: sesion.estado,
        fecha: sesion.fecha,
        saldoInicial: parseFloat(sesion.saldo_inicial || "0"),
        totalIngresos: sesion.total_ingresos ? parseFloat(sesion.total_ingresos) : totales.totalIngresos,
        totalEgresos: sesion.total_egresos ? parseFloat(sesion.total_egresos) : totales.totalEgresos,
        totalIngresosEfectivo: sesion.total_ingresos_efectivo ? parseFloat(sesion.total_ingresos_efectivo) : totales.totalIngresosEfectivo,
        totalEgresosEfectivo: sesion.total_egresos_efectivo ? parseFloat(sesion.total_egresos_efectivo) : totales.totalEgresosEfectivo,
        conteoFisico: sesion.conteo_fisico ? parseFloat(sesion.conteo_fisico) : null,
        diferencia: sesion.diferencia ? parseFloat(sesion.diferencia) : null,
        observacionesCierre: sesion.observaciones_cierre,
        usuarioApertura: sesion.usuario_apertura
          ? { id: sesion.usuario_apertura.id, nombre: sesion.usuario_apertura.nombre }
          : null,
        usuarioCierre: sesion.usuario_cierre
          ? { id: sesion.usuario_cierre.id, nombre: sesion.usuario_cierre.nombre }
          : null,
        openedAt: sesion.opened_at,
        closedAt: sesion.closed_at,
      },
      movimientos,
      ...totales,
    })
  } catch (err) {
    console.error("Error fetching sesion detail:", err)
    return NextResponse.json({ error: "Error al obtener sesión" }, { status: 500 })
  }
}
