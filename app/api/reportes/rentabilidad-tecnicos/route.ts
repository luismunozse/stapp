import { NextResponse } from "next/server"
import { requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { hasPlanFeature } from "@/lib/subscriptions"
import { sucursalParaLectura } from "@/lib/sucursal"

interface TecnicoRentabilidad {
  tecnicoId: string
  nombre: string
  ordenes: number
  horasTrabajadas: number
  ingresos: number
  costoRepuestos: number
  costoManoObra: number
  comision: number
  ganancia: number
  margen: number
  gananciaPorHora: number | null
}

/**
 * GET /api/reportes/rentabilidad-tecnicos?desde=ISO&hasta=ISO
 * Rentabilidad y horas por técnico en un rango (default: mes actual).
 * Período por fecha_completado. Gateado por advanced_reports.
 */
export async function GET(request: Request) {
  try {
    const { error, organizationId, role, session } = await requireAdminOrVendedor()
    if (error) return error

    const hasFeature = await hasPlanFeature(organizationId!, "advanced_reports")
    if (!hasFeature) {
      return NextResponse.json(
        { error: "Este reporte requiere el plan Profesional", code: "FEATURE_REQUIRED", feature: "advanced_reports" },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(request.url)
    const desdeParam = searchParams.get("desde")
    const hastaParam = searchParams.get("hasta")

    let desde: Date
    let hasta: Date
    if (desdeParam) {
      desde = new Date(desdeParam)
      if (Number.isNaN(desde.getTime())) {
        return NextResponse.json({ error: "Parámetro 'desde' inválido" }, { status: 400 })
      }
    } else {
      desde = new Date()
      desde.setDate(1)
      desde.setHours(0, 0, 0, 0)
    }
    if (hastaParam) {
      hasta = new Date(hastaParam)
      if (Number.isNaN(hasta.getTime())) {
        return NextResponse.json({ error: "Parámetro 'hasta' inválido" }, { status: 400 })
      }
    } else {
      hasta = new Date()
      hasta.setHours(23, 59, 59, 999)
    }
    if (desde > hasta) {
      return NextResponse.json({ error: "'desde' no puede ser posterior a 'hasta'" }, { status: 400 })
    }

    const filtro = await sucursalParaLectura({ role, userSucursalId: session!.user.sucursalId ?? null })

    // Fetch org flag for ENTREGADO_SIN_REPARACION commission behavior
    const { data: orgFlagData } = await supabaseAdmin
      .from("organizations")
      .select("comision_aplica_sin_reparacion")
      .eq("id", organizationId!)
      .single()
    const comisionAplicaSinReparacion = orgFlagData?.comision_aplica_sin_reparacion ?? false

    let ordenesQuery = supabaseAdmin
      .from("ordenes_servicio")
      .select(`
        id, tecnico_id, costo_final, porcentaje_comision, estado,
        horas_trabajadas, costo_mano_obra,
        tecnico:users!tecnico_id(nombre),
        repuestos_orden (cantidad, precio_unitario),
        cotizaciones (
          estado, deleted_at,
          items_cotizacion (cantidad, costo_unitario, inventario:inventario_id(precio_compra))
        )
      `)
      .eq("organization_id", organizationId!)
      .not("costo_final", "is", null)
      .not("tecnico_id", "is", null)
      .in("estado", ["REPARADO", "ENTREGADO", "ENTREGADO_SIN_REPARACION"])
      .gte("fecha_completado", desde.toISOString())
      .lte("fecha_completado", hasta.toISOString())

    if (!filtro.verTodas && filtro.sucursalId) {
      ordenesQuery = ordenesQuery.eq("sucursal_id", filtro.sucursalId)
    }

    const { data: ordenes, error: dbError } = await ordenesQuery

    if (dbError) throw dbError

    interface Acc {
      nombre: string
      ordenes: number
      horas: number
      ingresos: number
      repuestos: number
      manoObra: number
      comision: number
    }
    const porTecnico: Record<string, Acc> = {}

    for (const orden of (ordenes || []) as any[]) {
      const tecnicoId = orden.tecnico_id
      const nombre = orden.tecnico?.nombre || "Sin nombre"
      const ingreso = parseFloat(orden.costo_final || "0")

      let costoRepuestos = 0
      for (const r of (orden.repuestos_orden || [])) {
        costoRepuestos += (r.cantidad || 0) * parseFloat(r.precio_unitario || "0")
      }
      for (const c of (orden.cotizaciones || [])) {
        if (c.deleted_at || c.estado !== "ACEPTADA") continue
        for (const it of (c.items_cotizacion || [])) {
          const costo = it.costo_unitario != null
            ? parseFloat(it.costo_unitario)
            : (it.inventario ? parseFloat(it.inventario.precio_compra || "0") : 0)
          if (costo <= 0) continue
          costoRepuestos += (it.cantidad || 0) * costo
        }
      }

      let comision = 0
      const pct = parseFloat(orden.porcentaje_comision || "0")
      const sinReparacionBloqueado = orden.estado === "ENTREGADO_SIN_REPARACION" && !comisionAplicaSinReparacion
      if (ingreso > 0 && pct > 0 && !sinReparacionBloqueado) {
        comision = (Math.max(0, ingreso - costoRepuestos) * pct) / 100
      }

      const manoObra = parseFloat(orden.costo_mano_obra || "0") || 0
      const horas = parseFloat(orden.horas_trabajadas || "0") || 0

      if (!porTecnico[tecnicoId]) {
        porTecnico[tecnicoId] = { nombre, ordenes: 0, horas: 0, ingresos: 0, repuestos: 0, manoObra: 0, comision: 0 }
      }
      const acc = porTecnico[tecnicoId]
      acc.ordenes++
      acc.horas += horas
      acc.ingresos += ingreso
      acc.repuestos += costoRepuestos
      acc.manoObra += manoObra
      acc.comision += comision
    }

    const data: TecnicoRentabilidad[] = Object.entries(porTecnico).map(([tecnicoId, a]) => {
      const ganancia = a.ingresos - a.repuestos - a.manoObra - a.comision
      const margen = a.ingresos > 0 ? Math.round((ganancia / a.ingresos) * 100) : 0
      const gananciaPorHora = a.horas > 0 ? Math.round((ganancia / a.horas) * 100) / 100 : null
      return {
        tecnicoId,
        nombre: a.nombre,
        ordenes: a.ordenes,
        horasTrabajadas: Math.round(a.horas * 100) / 100,
        ingresos: Math.round(a.ingresos),
        costoRepuestos: Math.round(a.repuestos),
        costoManoObra: Math.round(a.manoObra),
        comision: Math.round(a.comision),
        ganancia: Math.round(ganancia),
        margen,
        gananciaPorHora,
      }
    }).sort((x, y) => y.ganancia - x.ganancia)

    const totalIngresos = data.reduce((s, d) => s + d.ingresos, 0)
    const totalCostos = data.reduce((s, d) => s + d.costoRepuestos + d.costoManoObra + d.comision, 0)
    const margenPromedio = totalIngresos > 0
      ? Math.round(((totalIngresos - totalCostos) / totalIngresos) * 100)
      : 0

    return NextResponse.json({
      data,
      totales: {
        tecnicos: data.length,
        ingresos: totalIngresos,
        ganancia: totalIngresos - totalCostos,
        horas: Math.round(data.reduce((s, d) => s + d.horasTrabajadas, 0) * 100) / 100,
      },
      margenPromedio,
      periodo: { desde: desde.toISOString(), hasta: hasta.toISOString() },
    })
  } catch (err) {
    console.error("Error en rentabilidad por técnico:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
