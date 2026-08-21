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

interface TecnicoRentabilidad {
  tecnicoId: string
  nombre: string
  ordenes: number
  horasTrabajadas: number
  ingresos: number
  /** null cuando el rol no puede ver costos de compra: repuestos_orden
   *  .precio_unitario es una copia congelada de precio_compra. */
  costoRepuestos: number | null
  costoManoObra: number
  comision: number | null
  ganancia: number | null
  margen: number | null
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

    // Se resuelve ACÁ, antes de armar la lista: el ranking por ganancia es una
    // clave de costo y el orden sobrevive al nulleo. Ver el sort de más abajo.
    //
    // Hacen falta las DOS llaves, porque costoRepuestos mezcla dos costos de
    // origen distinto: repuestos_orden.precio_unitario —precio_compra
    // congelado, que gobierna hasInventarioAccess— e
    // items_cotizacion.costo_unitario, que gobierna canViewCotizacionCosts,
    // ADMIN-only a propósito y MÁS estricta (costo de cotización y costo de
    // inventario son permisos independientes; ver lib/auth-utils.ts). Un
    // VENDEDOR con el opt-in de inventario leyendo un agregado armado en parte
    // con costos de cotización es el mismo agujero con otra forma.
    //
    // NO se parte el agregado en una cifra "sólo repuestos" para ese rol: un
    // número de rentabilidad al que le falta parte del costo es peor que uno
    // ausente, porque se lee como exacto.
    //
    // canViewCotizacionCosts corta primero: si no pasa, el flag ya es false y
    // nos ahorramos el SELECT de resolveVendedoresHabilitados. El resolutor de
    // inventario queda intacto, así que si algún día esa regla admite VENDEDOR
    // esto sigue siendo correcto.
    const canViewCost = canViewCotizacionCosts(role)
      ? hasInventarioAccess(
          role,
          role === "VENDEDOR" ? await resolveVendedoresHabilitados(organizationId!) : false
        )
      : false

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

    // Filas completas primero. El gate se aplica recién al escribir la
    // respuesta, así los totales se siguen calculando sobre las cifras reales
    // y no sobre los nulls.
    const filas = Object.entries(porTecnico).map(([tecnicoId, a]) => {
      const ganancia = a.ingresos - a.repuestos - a.manoObra - a.comision
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
        margen: a.ingresos > 0 ? Math.round((ganancia / a.ingresos) * 100) : 0,
        gananciaPorHora: a.horas > 0 ? Math.round((ganancia / a.horas) * 100) / 100 : null,
      }
    })

    // El orden es un canal lateral, igual que en masValiosos y sinMovimiento:
    // ganancia es ingresos menos costos, ingresos viaja visible en cada fila, y
    // entonces el ranking por ganancia ES el ranking por costo aunque el número
    // vaya en null. Para quien no puede ver costo se ordena por ingresos, que
    // ya ve. Para quien sí puede, el informe no cambia.
    filas.sort(
      canViewCost
        ? (x, y) => y.ganancia - x.ganancia
        : (x, y) => y.ingresos - x.ingresos || x.nombre.localeCompare(y.nombre, "es")
    )

    const totalIngresos = filas.reduce((s, d) => s + d.ingresos, 0)
    const totalCostos = filas.reduce((s, d) => s + d.costoRepuestos + d.costoManoObra + d.comision, 0)
    const margenPromedio = totalIngresos > 0
      ? Math.round(((totalIngresos - totalCostos) / totalIngresos) * 100)
      : 0

    // Mismo gate que /api/reportes/analisis-inventario e
    // /api/reportes/inventario-analytics, por la misma regla: quien no puede
    // ver el costo de compra por item no recibe NINGUNA cifra derivada de
    // precio_compra, a ningún nivel de agregación.
    //
    // Acá el costo entra por dos caminos y los dos son precio_compra:
    // repuestos_orden.precio_unitario es la copia CONGELADA del costo de
    // compra, e items_cotizacion cae de vuelta a inventario.precio_compra
    // cuando no tiene costo_unitario propio. Con un técnico de una sola orden
    // que consumió un solo repuesto de cantidad 1 —el caso de una orden
    // recién cargada— costoRepuestos ES el precio de compra exacto, el mismo
    // número que /api/ordenes/[id] ya le niega al rol.
    //
    // No alcanza con tapar costoRepuestos: ganancia es
    // ingresos - costoRepuestos - costoManoObra - comision, y ingresos y
    // costoManoObra viajan visibles al lado, así que la resta lo devuelve.
    // margen y gananciaPorHora son ganancia reescalada por divisores visibles
    // (ingresos y horasTrabajadas), y comision es
    // (ingresos - costoRepuestos) x porcentaje: con el porcentaje de comisión
    // de la casa —que no es secreto para quien lee este informe— también se
    // invierte. Toda la clausura se gatea junta o no se gatea ninguna.
    //
    // Lo que NO deriva de precio_compra sigue visible: ordenes, horas,
    // ingresos y costoManoObra, que es mano de obra propia y otro tier.
    const data: TecnicoRentabilidad[] = canViewCost
      ? filas
      : filas.map((f) => ({
          ...f,
          costoRepuestos: null,
          comision: null,
          ganancia: null,
          margen: null,
          gananciaPorHora: null,
        }))

    return NextResponse.json({
      data,
      totales: {
        tecnicos: data.length,
        ingresos: totalIngresos,
        ganancia: canViewCost ? totalIngresos - totalCostos : null,
        horas: Math.round(filas.reduce((s, d) => s + d.horasTrabajadas, 0) * 100) / 100,
      },
      margenPromedio: canViewCost ? margenPromedio : null,
      periodo: { desde: desde.toISOString(), hasta: hasta.toISOString() },
    })
  } catch (err) {
    console.error("Error en rentabilidad por técnico:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
