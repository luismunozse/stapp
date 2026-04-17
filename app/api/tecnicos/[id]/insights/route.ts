import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params
    const { searchParams } = new URL(request.url)
    const dias = parseInt(searchParams.get("dias") || "90", 10)
    const desde = new Date()
    desde.setDate(desde.getDate() - dias)
    const desdeISO = desde.toISOString()

    // Validar técnico
    const { data: tec } = await supabaseAdmin
      .from("users")
      .select("id, nombre")
      .eq("id", id)
      .eq("rol", "TECNICO")
      .eq("organization_id", organizationId!)
      .single()
    if (!tec) return NextResponse.json({ error: "Técnico no encontrado" }, { status: 404 })

    // Órdenes del técnico (recientes)
    const { data: ordenes } = await supabaseAdmin
      .from("ordenes_servicio")
      .select(`
        id, numero_orden, codigo_orden, dispositivo, tipo_dispositivo, marca, estado,
        fecha_ingreso, fecha_completado, fecha_prometida,
        costo_final, es_reingreso,
        repuestos_orden (cantidad, precio_unitario, inventario_id, nombre, inventario:inventario_id (id, nombre))
      `)
      .eq("tecnico_id", id)
      .eq("organization_id", organizationId!)
      .gte("fecha_ingreso", desdeISO)
      .order("fecha_ingreso", { ascending: false })

    const ords = ordenes || []

    const completadas = ords.filter((o: any) => ["REPARADO", "ENTREGADO"].includes(o.estado))
    const reingresos = ords.filter((o: any) => o.es_reingreso).length
    const sinReparacion = ords.filter((o: any) => o.estado === "SIN_REPARACION").length
    const activas = ords.filter((o: any) =>
      !["REPARADO", "ENTREGADO", "ENTREGADO_SIN_REPARACION", "CANCELADO", "SIN_REPARACION"].includes(o.estado)
    )
    const esperandoRepuesto = ords.filter((o: any) => o.estado === "ESPERANDO_REPUESTO")

    // TAT (Turnaround Time): horas entre fecha_ingreso y fecha_completado
    const tats = completadas
      .filter((o: any) => o.fecha_ingreso && o.fecha_completado)
      .map((o: any) => (new Date(o.fecha_completado).getTime() - new Date(o.fecha_ingreso).getTime()) / 36e5)
    const tatPromedio = tats.length ? tats.reduce((a, b) => a + b, 0) / tats.length : 0
    const tatMediana = tats.length ? [...tats].sort((a, b) => a - b)[Math.floor(tats.length / 2)] : 0

    // SLA: completadas vencieron su fecha_prometida
    const vencidas = ords.filter((o: any) => {
      if (!o.fecha_prometida) return false
      const due = new Date(o.fecha_prometida).getTime()
      if (o.fecha_completado) return new Date(o.fecha_completado).getTime() > due
      return Date.now() > due && !["CANCELADO", "SIN_REPARACION"].includes(o.estado)
    }).length
    const conFechaPrometida = ords.filter((o: any) => o.fecha_prometida).length
    const tasaSla = conFechaPrometida ? 1 - vencidas / conFechaPrometida : null

    // Ingresos generados (solo completadas)
    const ingresos = completadas.reduce((acc: number, o: any) => acc + Number(o.costo_final || 0), 0)

    // Breakdown por tipo de dispositivo
    const tipoMap = new Map<string, number>()
    for (const o of ords as any[]) {
      const k = o.tipo_dispositivo || "OTRO"
      tipoMap.set(k, (tipoMap.get(k) || 0) + 1)
    }
    const porTipo = Array.from(tipoMap.entries())
      .map(([tipo, count]) => ({ tipo, count }))
      .sort((a, b) => b.count - a.count)

    // Breakdown por marca
    const marcaMap = new Map<string, number>()
    for (const o of ords as any[]) {
      if (!o.marca) continue
      marcaMap.set(o.marca, (marcaMap.get(o.marca) || 0) + 1)
    }
    const porMarca = Array.from(marcaMap.entries())
      .map(([marca, count]) => ({ marca, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)

    // Top repuestos usados
    const repMap = new Map<string, { nombre: string; cantidad: number; monto: number }>()
    for (const o of ords as any[]) {
      for (const r of o.repuestos_orden || []) {
        const nombre = r.inventario?.nombre || r.nombre || "Repuesto"
        const key = r.inventario_id || nombre
        const cur = repMap.get(key) || { nombre, cantidad: 0, monto: 0 }
        cur.cantidad += Number(r.cantidad || 0)
        cur.monto += Number(r.cantidad || 0) * Number(r.precio_unitario || 0)
        repMap.set(key, cur)
      }
    }
    const topRepuestos = Array.from(repMap.values())
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 5)

    // Productividad por semana (últimas 8 semanas)
    const ahora = new Date()
    const semanas: Array<{ semana: string; completadas: number; ingresos: number }> = []
    for (let i = 7; i >= 0; i--) {
      const end = new Date(ahora)
      end.setDate(end.getDate() - i * 7)
      const start = new Date(end)
      start.setDate(end.getDate() - 6)
      const compInRange = completadas.filter((o: any) => {
        if (!o.fecha_completado) return false
        const d = new Date(o.fecha_completado)
        return d >= start && d <= end
      })
      semanas.push({
        semana: `${start.getDate()}/${start.getMonth() + 1}`,
        completadas: compInRange.length,
        ingresos: compInRange.reduce((acc: number, o: any) => acc + Number(o.costo_final || 0), 0),
      })
    }

    // Órdenes bloqueadas (esperando repuesto) con días bloqueadas — usar fecha_ingreso como proxy
    const bloqueadas = esperandoRepuesto.map((o: any) => ({
      id: o.id,
      codigoOrden: o.codigo_orden,
      numeroOrden: o.numero_orden,
      dispositivo: o.dispositivo,
      dias: Math.floor((Date.now() - new Date(o.fecha_ingreso).getTime()) / 86400000),
    })).sort((a, b) => b.dias - a.dias)

    // Próximas a vencer (en 48h, activas, con fecha_prometida)
    const en48h = Date.now() + 48 * 3600 * 1000
    const proximasVencer = activas
      .filter((o: any) => o.fecha_prometida)
      .map((o: any) => {
        const due = new Date(o.fecha_prometida).getTime()
        return {
          id: o.id,
          codigoOrden: o.codigo_orden,
          numeroOrden: o.numero_orden,
          dispositivo: o.dispositivo,
          estado: o.estado,
          fechaPrometida: o.fecha_prometida,
          horasRestantes: Math.floor((due - Date.now()) / 3600000),
          vencida: due < Date.now(),
        }
      })
      .filter((o: any) => o.vencida || (o.horasRestantes <= 48 && o.horasRestantes >= -720))
      .sort((a, b) => a.horasRestantes - b.horasRestantes)
      .slice(0, 5)

    return NextResponse.json({
      rangoDias: dias,
      totales: {
        totalOrdenes: ords.length,
        completadas: completadas.length,
        activas: activas.length,
        reingresos,
        sinReparacion,
        vencidas,
        ingresos,
      },
      calidad: {
        tasaReingresos: completadas.length ? reingresos / completadas.length : 0,
        tasaSinReparacion: ords.length ? sinReparacion / ords.length : 0,
        tasaSla, // null si no hay órdenes con fecha_prometida
      },
      tiempos: {
        tatPromedioHoras: Math.round(tatPromedio * 10) / 10,
        tatMedianaHoras: Math.round(tatMediana * 10) / 10,
      },
      especializacion: { porTipo, porMarca },
      topRepuestos,
      semanas,
      bloqueadas,
      proximasVencer,
    }, { headers: { "Cache-Control": "no-store" } })
  } catch (err) {
    console.error("Error insights tecnico:", err)
    return NextResponse.json({ error: "Error al obtener insights" }, { status: 500 })
  }
}
