import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { fetchMovimientosDia, computeTotales } from "@/lib/caja-utils"
import { z } from "zod"

const cierreSchema = z.object({
  conteoFisico: z.number().min(0, "El conteo físico no puede ser negativo"),
  observaciones: z.string().optional(),
})

// POST - Cerrar sesión de caja (arqueo)
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId } = await requireAdmin()
    if (error) return error

    const { id } = await params
    const body = await request.json()
    const parsed = cierreSchema.parse(body)

    // Obtener sesión y verificar
    const { data: sesion } = await supabaseAdmin
      .from("sesiones_caja")
      .select("*")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (!sesion) {
      return NextResponse.json({ error: "Sesión no encontrada" }, { status: 404 })
    }

    if (sesion.estado === "CERRADA") {
      return NextResponse.json({ error: "La sesión ya está cerrada" }, { status: 400 })
    }

    // Calcular totales del período
    const fechaDesde = sesion.opened_at
    const fechaHasta = new Date().toISOString()

    const movimientos = await fetchMovimientosDia(organizationId!, fechaDesde, fechaHasta, undefined, sesion.sucursal_id)
    const totales = computeTotales(movimientos)

    // Calcular arqueo
    const saldoInicial = parseFloat(sesion.saldo_inicial || "0")
    const esperado = saldoInicial + totales.totalIngresosEfectivo - totales.totalEgresosEfectivo
    const diferencia = parsed.conteoFisico - esperado

    // Actualizar sesión
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("sesiones_caja")
      .update({
        estado: "CERRADA",
        usuario_cierre_id: userId!,
        total_ingresos: totales.totalIngresos,
        total_egresos: totales.totalEgresos,
        total_ingresos_efectivo: totales.totalIngresosEfectivo,
        total_egresos_efectivo: totales.totalEgresosEfectivo,
        conteo_fisico: parsed.conteoFisico,
        diferencia,
        observaciones_cierre: parsed.observaciones || null,
        closed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single()

    if (updateError) {
      console.error("Error closing sesion:", updateError)
      return NextResponse.json({ error: "Error al cerrar caja" }, { status: 500 })
    }

    return NextResponse.json({
      sesion: updated,
      arqueo: {
        saldoInicial,
        totalIngresosEfectivo: totales.totalIngresosEfectivo,
        totalEgresosEfectivo: totales.totalEgresosEfectivo,
        esperado,
        conteoFisico: parsed.conteoFisico,
        diferencia,
      },
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error closing caja:", err)
    return NextResponse.json({ error: "Error al cerrar caja" }, { status: 500 })
  }
}
