import { NextResponse } from "next/server"
import {
  requireAdminOrVendedor,
  hasInventarioAccess,
  resolveVendedoresHabilitados,
  canViewCotizacionCosts,
} from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { hasPlanFeature } from "@/lib/subscriptions"
import { sucursalParaLectura } from "@/lib/sucursal"

export async function GET() {
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

    const filtro = await sucursalParaLectura({ role, userSucursalId: session!.user.sucursalId ?? null })

    // Fetch org flag for ENTREGADO_SIN_REPARACION commission behavior
    const { data: orgFlagData } = await supabaseAdmin
      .from("organizations")
      .select("comision_aplica_sin_reparacion")
      .eq("id", organizationId!)
      .single()
    const comisionAplicaSinReparacion = orgFlagData?.comision_aplica_sin_reparacion ?? false

    // Obtener órdenes completadas con costo final y repuestos
    let ordenesQuery = supabaseAdmin
      .from("ordenes_servicio")
      .select(`
        id, tipo_dispositivo, costo_final, estado,
        porcentaje_comision, tecnico_id, costo_mano_obra,
        repuestos_orden (cantidad, precio_unitario),
        cotizaciones (
          estado, deleted_at,
          items_cotizacion (cantidad, costo_unitario, inventario:inventario_id(precio_compra))
        )
      `)
      .eq("organization_id", organizationId!)
      .not("costo_final", "is", null)
      .in("estado", ["REPARADO", "ENTREGADO", "ENTREGADO_SIN_REPARACION"])

    if (!filtro.verTodas && filtro.sucursalId) {
      ordenesQuery = ordenesQuery.eq("sucursal_id", filtro.sucursalId)
    }

    const { data: ordenes } = await ordenesQuery

    // Sin órdenes no hay margen que calcular. Va null y no 0 para que el campo
    // tenga UNA sola forma: el camino con datos ya devuelve null cuando el rol
    // no puede ver costos, y dos formas para el mismo campo es como el próximo
    // lector arma una suposición equivocada.
    if (!ordenes || ordenes.length === 0) {
      return NextResponse.json({ data: [], margenPromedio: null })
    }

    // Se resuelve ACÁ, antes de armar la lista: el ranking por ganancia es una
    // clave de costo y el orden sobrevive al nulleo. Ver el sort de más abajo.
    //
    // Hacen falta las DOS llaves, porque `costos` mezcla dos costos de origen
    // distinto: repuestos_orden.precio_unitario —precio_compra congelado, que
    // gobierna hasInventarioAccess— e items_cotizacion.costo_unitario, que
    // gobierna canViewCotizacionCosts, ADMIN-only a propósito y MÁS estricta
    // (costo de cotización y costo de inventario son permisos independientes;
    // ver lib/auth-utils.ts). Un VENDEDOR con el opt-in de inventario leyendo
    // un agregado armado en parte con costos de cotización es el mismo agujero
    // con otra forma.
    //
    // NO se parte el agregado en una cifra "sólo repuestos" para ese rol: un
    // número de rentabilidad al que le falta parte del costo es peor que uno
    // ausente, porque se lee como exacto.
    //
    // canViewCotizacionCosts corta primero y ahorra el SELECT de
    // resolveVendedoresHabilitados cuando ya sabemos la respuesta.
    const canViewCost = canViewCotizacionCosts(role)
      ? hasInventarioAccess(
          role,
          role === "VENDEDOR" ? await resolveVendedoresHabilitados(organizationId!) : false
        )
      : false

    // Calcular rentabilidad por tipo de dispositivo
    // Costos incluyen: repuestos consumidos + cotizaciones aceptadas (inv) + comisión técnico.
    const porTipo: Record<string, { ingresos: number; costos: number; manoObra: number; count: number }> = {}

    for (const orden of ordenes as any[]) {
      const tipo = orden.tipo_dispositivo || "OTRO"
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
      const sinReparacionBloqueado = orden.estado === "ENTREGADO_SIN_REPARACION" && !comisionAplicaSinReparacion
      if (orden.tecnico_id && ingreso > 0 && !sinReparacionBloqueado) {
        const pct = parseFloat(orden.porcentaje_comision || "0")
        if (pct > 0) {
          const ganancia = Math.max(0, ingreso - costoRepuestos)
          comision = (ganancia * pct) / 100
        }
      }

      const manoObra = parseFloat(orden.costo_mano_obra || "0") || 0

      if (!porTipo[tipo]) {
        porTipo[tipo] = { ingresos: 0, costos: 0, manoObra: 0, count: 0 }
      }
      porTipo[tipo].ingresos += ingreso
      porTipo[tipo].costos += costoRepuestos + comision + manoObra
      porTipo[tipo].manoObra += manoObra
      porTipo[tipo].count++
    }

    // Filas completas primero; el gate se aplica al escribir la respuesta, así
    // los totales se calculan sobre las cifras reales y no sobre los nulls.
    const filas = Object.entries(porTipo).map(([tipo, stats]) => {
      const ganancia = stats.ingresos - stats.costos
      const margen = stats.ingresos > 0 ? Math.round((ganancia / stats.ingresos) * 100) : 0

      return {
        tipoDispositivo: tipo,
        ingresos: Math.round(stats.ingresos),
        costos: Math.round(stats.costos),
        costoManoObra: Math.round(stats.manoObra),
        ganancia: Math.round(ganancia),
        margen,
        cantidad: stats.count,
      }
    })

    // El orden es un canal lateral: ganancia es ingresos menos costos e
    // ingresos viaja visible en cada fila, así que el ranking por ganancia
    // devuelve el ranking por costo aunque el número vaya en null. Para quien
    // no puede ver costo se ordena por ingresos, que ya ve.
    filas.sort(
      canViewCost
        ? (a, b) => b.ganancia - a.ganancia
        : (a, b) => b.ingresos - a.ingresos || a.tipoDispositivo.localeCompare(b.tipoDispositivo, "es")
    )

    const totalIngresos = filas.reduce((acc, d) => acc + d.ingresos, 0)
    const totalCostos = filas.reduce((acc, d) => acc + d.costos, 0)
    const margenPromedio = totalIngresos > 0
      ? Math.round(((totalIngresos - totalCostos) / totalIngresos) * 100)
      : 0

    // Mismo gate y misma regla que las rutas hermanas: quien no puede ver el
    // costo de compra por item no recibe NINGUNA cifra derivada de
    // precio_compra, a ningún nivel de agregación.
    //
    // `costos` agrega repuestos_orden.precio_unitario —la copia congelada del
    // costo de compra— más items_cotizacion, que cae de vuelta a
    // inventario.precio_compra. Un tipo de dispositivo puede tener una sola
    // orden, y entonces costos menos el costoManoObra visible es el costo del
    // repuesto.
    //
    // ganancia es ingresos - costos con ingresos visible al lado, así que
    // taparle solo `costos` lo devolvería por resta; margen es esa misma
    // ganancia sobre ingresos. Se gatea la clausura entera.
    //
    // ingresos, costoManoObra y cantidad no derivan de precio_compra y siguen
    // visibles.
    const data = canViewCost
      ? filas
      : filas.map((f) => ({ ...f, costos: null, ganancia: null, margen: null }))

    return NextResponse.json({
      data,
      margenPromedio: canViewCost ? margenPromedio : null,
    })
  } catch (err) {
    console.error("Error en reporte rentabilidad:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
