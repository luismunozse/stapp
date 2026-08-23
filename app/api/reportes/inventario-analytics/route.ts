import {
  requireAdminOrVendedor,
  hasInventarioAccess,
  resolveVendedoresHabilitados,
} from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { NextResponse } from "next/server"

export async function GET() {
  const { error, organizationId, role } = await requireAdminOrVendedor()
  if (error) return error

  const now = new Date()
  const hace90Dias = new Date(now)
  hace90Dias.setDate(now.getDate() - 90)
  const hace30Dias = new Date(now)
  hace30Dias.setDate(now.getDate() - 30)

  try {
    const [
      inventarioResult,
      movimientosVentaResult,
      movimientos30DiasResult,
    ] = await Promise.all([
      // All active inventory items (exclude archived)
      supabaseAdmin
        .from("inventario")
        .select("id, codigo, nombre, categoria, tipo_dispositivo, stock, precio_compra, precio_venta, proveedor, stock_minimo, punto_reorden")
        .eq("organization_id", organizationId!)
        .is("deleted_at", null),

      // Sale movements last 90 days
      supabaseAdmin
        .from("movimientos_inventario")
        .select("inventario_id, cantidad, created_at")
        .eq("organization_id", organizationId!)
        .eq("tipo", "VENTA")
        .gte("created_at", hace90Dias.toISOString()),

      // Sale movements last 30 days (for trend)
      supabaseAdmin
        .from("movimientos_inventario")
        .select("cantidad, created_at")
        .eq("organization_id", organizationId!)
        .eq("tipo", "VENTA")
        .gte("created_at", hace30Dias.toISOString()),
    ])

    const items = inventarioResult.data || []
    const movimientos90 = movimientosVentaResult.data || []
    const movimientos30 = movimientos30DiasResult.data || []

    // Se resuelve ACÁ, antes de armar las listas derivadas, y no al final junto
    // con el nulleo: hay listas que se ORDENAN por una clave de costo, y el
    // orden sobrevive al nulleo. Ver sinMovimiento más abajo.
    const vendedoresHabilitados = role === "VENDEDOR"
      ? await resolveVendedoresHabilitados(organizationId!)
      : false
    const canViewCost = hasInventarioAccess(role, vendedoresHabilitados)

    // --- Valorización ---
    let valorCosto = 0
    let valorVenta = 0
    let totalUnidades = 0
    items.forEach(item => {
      valorCosto += (item.stock || 0) * (item.precio_compra || 0)
      valorVenta += (item.stock || 0) * (item.precio_venta || 0)
      totalUnidades += item.stock || 0
    })
    // Las cifras de costo van gateadas como el resto (ver el bloque de abajo):
    // totalItems y totalUnidades viajan al lado, así que un valorCosto visible
    // se divide de vuelta al costo unitario.
    const valorizacion = {
      valorCosto: canViewCost ? valorCosto : null,
      valorVenta,
      margenPotencial: canViewCost ? valorVenta - valorCosto : null,
      totalItems: items.length,
      totalUnidades,
    }

    // --- Aggregate sales per item (90 days) ---
    const ventasPorItem: Record<string, number> = {}
    movimientos90.forEach((m: any) => {
      const id = m.inventario_id
      if (!ventasPorItem[id]) ventasPorItem[id] = 0
      ventasPorItem[id] += Math.abs(m.cantidad || 0)
    })

    // --- Rotación ---
    const rotacion = items
      .filter(item => ventasPorItem[item.id])
      .map(item => {
        const totalVendido = ventasPorItem[item.id] || 0
        const stock = item.stock || 1
        const tasaRotacion = (totalVendido / stock) * 4 // annualized
        return {
          inventarioId: item.id,
          nombre: item.nombre,
          codigo: item.codigo,
          stock: item.stock,
          precioVenta: item.precio_venta,
          totalVendido,
          tasaRotacion: Math.round(tasaRotacion * 100) / 100,
        }
      })
      .sort((a, b) => b.totalVendido - a.totalVendido)
      .slice(0, 15)

    // --- Sin Movimiento (dead stock) ---
    const itemsConVenta = new Set(Object.keys(ventasPorItem))
    // El orden es un canal lateral: capitalInmovilizado es stock x
    // precio_compra y stock viaja visible en cada fila, así que un ranking por
    // capital devuelve el ranking de costo unitario aunque el número esté en
    // null. El recorte tampoco es inocente: pertenecer al "top 20 por capital"
    // ES el ranking. Para quien no puede ver costo, la clave y el recorte pasan
    // a stock, que ya ve. Para quien sí puede, el informe no cambia.
    const sinMovimientoBase = items
      .filter(item => !itemsConVenta.has(item.id) && item.stock > 0)
      .map(item => ({
        id: item.id,
        nombre: item.nombre,
        codigo: item.codigo,
        stock: item.stock,
        precioCompra: item.precio_compra,
        precioVenta: item.precio_venta,
        capitalInmovilizado: (item.stock || 0) * (item.precio_compra || 0),
      }))

    const sinMovimiento = (
      canViewCost
        ? sinMovimientoBase.sort((a, b) => b.capitalInmovilizado - a.capitalInmovilizado)
        : sinMovimientoBase.sort(
            (a, b) => b.stock - a.stock || (a.nombre || "").localeCompare(b.nombre || "", "es")
          )
    ).slice(0, 20)

    // --- Alertas de Reorden ---
    const diasPeriodo = 90
    const alertasReorden = items
      .filter(item => {
        const vendido = ventasPorItem[item.id] || 0
        const promedioDiario = vendido / diasPeriodo
        // Use per-item punto_reorden if set, otherwise calculate from sales
        const puntoReordenCalc = item.punto_reorden ?? Math.ceil(promedioDiario * 14)
        return item.stock <= puntoReordenCalc && (promedioDiario > 0 || item.punto_reorden != null)
      })
      .map(item => {
        const vendido = ventasPorItem[item.id] || 0
        const promedioDiario = vendido / diasPeriodo
        const puntoReordenCalc = item.punto_reorden ?? Math.ceil(promedioDiario * 14)
        const diasHastaAgotamiento = promedioDiario > 0 ? Math.round(item.stock / promedioDiario) : 999
        const cantidadSugerida = Math.max(0, Math.ceil(puntoReordenCalc * 2 - item.stock))
        return {
          id: item.id,
          nombre: item.nombre,
          codigo: item.codigo,
          stock: item.stock,
          stockMinimo: item.stock_minimo,
          puntoReordenCustom: item.punto_reorden,
          promedioDiario: Math.round(promedioDiario * 100) / 100,
          diasHastaAgotamiento,
          puntoReorden: puntoReordenCalc,
          cantidadSugerida,
        }
      })
      .sort((a, b) => a.diasHastaAgotamiento - b.diasHastaAgotamiento)

    // --- Por Categoría ---
    const catMap: Record<string, { categoria: string; items: number; stock: number; valorCosto: number; valorVenta: number }> = {}
    items.forEach(item => {
      const cat = item.categoria || "Sin categoría"
      if (!catMap[cat]) catMap[cat] = { categoria: cat, items: 0, stock: 0, valorCosto: 0, valorVenta: 0 }
      catMap[cat].items++
      catMap[cat].stock += item.stock || 0
      catMap[cat].valorCosto += (item.stock || 0) * (item.precio_compra || 0)
      catMap[cat].valorVenta += (item.stock || 0) * (item.precio_venta || 0)
    })
    const porCategoria = Object.values(catMap).sort((a, b) => b.valorVenta - a.valorVenta)

    // --- Tendencia de Ventas (últimos 30 días) ---
    const tendenciaMap: Record<string, number> = {}
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(now.getDate() - i)
      tendenciaMap[d.toISOString().split("T")[0]] = 0
    }
    movimientos30.forEach((m: any) => {
      const key = m.created_at?.split("T")[0]
      if (key && tendenciaMap[key] !== undefined) {
        tendenciaMap[key] += Math.abs(m.cantidad || 0)
      }
    })
    const tendenciaVentas = Object.entries(tendenciaMap).map(([fecha, unidades]) => ({ fecha, unidades }))

    // El costo de compra sigue la misma regla que inventario.precio_compra en
    // el resto de la app.
    //
    // La regla, en una línea: quien no puede ver el costo de compra por item
    // no recibe NINGUNA cifra derivada de precio_compra, a ningún nivel de
    // agregación.
    //
    // Aplica a lo obvio (precioCompra por item), a lo que se cae por división
    // dentro de la misma fila (capitalInmovilizado es stock * precio_compra y
    // stock viaja al lado), al total por categoría (una categoría puede tener
    // un único SKU) y también al total de organización: con totalItems === 1
    // —una org nueva, o de un solo SKU— valorCosto / totalUnidades ES el costo
    // unitario exacto, y la valorización entregaba las dos cifras juntas.
    // Ídem resumen.valorCompra en /api/reportes/analisis-inventario, que
    // aplica esta misma regla.
    //
    // valorizacion.margenPotencial queda gateado como consecuencia, y ahora el
    // gate sí protege: es valorVenta - valorCosto, y valorCosto ya no viaja,
    // así que la resta que antes lo volvía decorativo perdió un término.
    //
    // Lo que NO es costo —totalItems, totalUnidades, valorVenta, conteos—
    // sigue visible: su tier no cambió.
    //
    // canViewCost se resolvió arriba, antes de armar las listas: el nulleo
    // solo tapa el número, no el orden en que la lista llegó hasta acá.
    const sinMovimientoGated = canViewCost
      ? sinMovimiento
      : sinMovimiento.map(item => ({ ...item, precioCompra: null, capitalInmovilizado: null }))

    const porCategoriaGated = porCategoria.map(cat => ({
      ...cat,
      valorCosto: canViewCost ? cat.valorCosto : null,
    }))

    return NextResponse.json({
      scope: "organization",
      valorizacion,
      rotacion,
      sinMovimiento: sinMovimientoGated,
      alertasReorden,
      porCategoria: porCategoriaGated,
      tendenciaVentas,
    }, {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (err) {
    console.error("Error en inventario-analytics:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
