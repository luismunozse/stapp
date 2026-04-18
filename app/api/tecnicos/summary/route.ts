import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const dias = Math.max(1, Math.min(365, parseInt(searchParams.get("dias") || "30", 10)))
    const desde = new Date()
    desde.setDate(desde.getDate() - dias)
    const desdeISO = desde.toISOString()

    const { data: ordenes, error: dbError } = await supabaseAdmin
      .from("ordenes_servicio")
      .select(
        "id, tecnico_id, estado, fecha_ingreso, fecha_completado, fecha_prometida, costo_final, es_reingreso"
      )
      .eq("organization_id", organizationId!)
      .not("tecnico_id", "is", null)
      .gte("fecha_ingreso", desdeISO)

    if (dbError) throw dbError

    type Acc = {
      ordenesPeriodo: number
      completadas: number
      reingresos: number
      vencidas: number
      conFechaPrometida: number
      ingresos: number
      tats: number[]
    }
    const map = new Map<string, Acc>()
    const now = Date.now()

    for (const o of ordenes || []) {
      const id = (o as any).tecnico_id as string | null
      if (!id) continue
      const acc = map.get(id) || {
        ordenesPeriodo: 0,
        completadas: 0,
        reingresos: 0,
        vencidas: 0,
        conFechaPrometida: 0,
        ingresos: 0,
        tats: [],
      }
      acc.ordenesPeriodo++
      if ((o as any).es_reingreso) acc.reingresos++
      const esCompletada = ["REPARADO", "ENTREGADO"].includes((o as any).estado)
      if (esCompletada) {
        acc.completadas++
        acc.ingresos += Number((o as any).costo_final || 0)
        if ((o as any).fecha_ingreso && (o as any).fecha_completado) {
          const h =
            (new Date((o as any).fecha_completado).getTime() -
              new Date((o as any).fecha_ingreso).getTime()) /
            36e5
          acc.tats.push(h)
        }
      }
      if ((o as any).fecha_prometida) {
        acc.conFechaPrometida++
        const due = new Date((o as any).fecha_prometida).getTime()
        const fc = (o as any).fecha_completado
        const estado = (o as any).estado
        const vencida = fc
          ? new Date(fc).getTime() > due
          : now > due && !["CANCELADO", "SIN_REPARACION"].includes(estado)
        if (vencida) acc.vencidas++
      }
      map.set(id, acc)
    }

    const tecnicos = Array.from(map.entries()).map(([id, a]) => {
      const tat = a.tats.length
        ? Math.round((a.tats.reduce((x, y) => x + y, 0) / a.tats.length) * 10) / 10
        : 0
      return {
        tecnicoId: id,
        ordenesPeriodo: a.ordenesPeriodo,
        completadas: a.completadas,
        reingresos: a.reingresos,
        vencidas: a.vencidas,
        ingresos: Math.round(a.ingresos * 100) / 100,
        tasaSla: a.conFechaPrometida ? 1 - a.vencidas / a.conFechaPrometida : null,
        tasaReingresos: a.completadas ? a.reingresos / a.completadas : 0,
        tatPromedioHoras: tat,
      }
    })

    return NextResponse.json(
      { rangoDias: dias, tecnicos },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (err) {
    console.error("Error summary tecnicos:", err)
    return NextResponse.json(
      { error: "Error al obtener resumen" },
      { status: 500 }
    )
  }
}
