import { NextResponse } from "next/server"
import { requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

interface ItemInventario {
  id: string
  codigo: string | null
  nombre: string
  categoria: string | null
  stock: number
  precioCompra: number | null
  precioVenta: number | null
}

interface CategoriaResumen {
  categoria: string
  cantidad: number
  stockTotal: number
  valorTotal: number
}

/**
 * GET /api/reportes/analisis-inventario
 * Análisis del inventario: stock crítico, valor total, por categoría
 */
export async function GET() {
  try {
    const { error, organizationId } = await requireAdminOrVendedor()
    if (error) return error

    // Obtener todo el inventario
    const { data: inventario, error: inventarioError } = await supabaseAdmin
      .from("inventario")
      .select("id, codigo, nombre, categoria, stock, precio_compra, precio_venta")
      .eq("organization_id", organizationId!)

    if (inventarioError) throw inventarioError

    const items: ItemInventario[] = (inventario || []).map((item) => ({
      id: item.id,
      codigo: item.codigo,
      nombre: item.nombre,
      categoria: item.categoria,
      stock: item.stock || 0,
      precioCompra: item.precio_compra,
      precioVenta: item.precio_venta,
    }))

    const { data: orgConfig } = await supabaseAdmin
      .from("organizations")
      .select("umbral_stock_bajo")
      .eq("id", organizationId!)
      .single()
    const threshold = orgConfig?.umbral_stock_bajo ?? 5

    // Items con stock crítico (< threshold)
    const stockCritico = items
      .filter((item) => item.stock < threshold)
      .sort((a, b) => a.stock - b.stock)
      .slice(0, 20)

    // Items sin stock
    const sinStock = items.filter((item) => item.stock === 0)

    // Calcular valor total del inventario
    const valorTotalCompra = items.reduce(
      (sum, item) => sum + (item.precioCompra || 0) * item.stock,
      0
    )
    const valorTotalVenta = items.reduce(
      (sum, item) => sum + (item.precioVenta || 0) * item.stock,
      0
    )

    // Agrupar por categoría
    const categoriaMap = new Map<string, CategoriaResumen>()
    items.forEach((item) => {
      const cat = item.categoria || "Sin categoría"
      const existing = categoriaMap.get(cat) || {
        categoria: cat,
        cantidad: 0,
        stockTotal: 0,
        valorTotal: 0,
      }
      existing.cantidad++
      existing.stockTotal += item.stock
      existing.valorTotal += (item.precioCompra || 0) * item.stock
      categoriaMap.set(cat, existing)
    })

    const porCategoria = Array.from(categoriaMap.values()).sort(
      (a, b) => b.valorTotal - a.valorTotal
    )

    // Items más valiosos (por valor en stock)
    const masValiosos = items
      .map((item) => ({
        ...item,
        valorEnStock: (item.precioCompra || 0) * item.stock,
      }))
      .filter((item) => item.valorEnStock > 0)
      .sort((a, b) => b.valorEnStock - a.valorEnStock)
      .slice(0, 10)

    // Top productos vendidos (últimos 30 días)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const { data: topVendidos } = await supabaseAdmin
      .from("movimientos_inventario")
      .select("inventario_id, cantidad, inventario:inventario_id (id, nombre, codigo)")
      .eq("organization_id", organizationId!)
      .eq("tipo", "VENTA")
      .gte("created_at", thirtyDaysAgo.toISOString())

    const ventasPorProducto: Record<string, { nombre: string; codigo: string; totalVendido: number }> = {}
    for (const mov of topVendidos || []) {
      const inv = mov.inventario as any
      if (!inv) continue
      const key = mov.inventario_id
      if (!ventasPorProducto[key]) {
        ventasPorProducto[key] = { nombre: inv.nombre, codigo: inv.codigo, totalVendido: 0 }
      }
      ventasPorProducto[key].totalVendido += mov.cantidad
    }

    const masVendidos = Object.values(ventasPorProducto)
      .sort((a, b) => b.totalVendido - a.totalVendido)
      .slice(0, 10)

    // Resumen general
    const resumen = {
      totalItems: items.length,
      totalUnidades: items.reduce((sum, item) => sum + item.stock, 0),
      valorCompra: valorTotalCompra,
      valorVenta: valorTotalVenta,
      margenPotencial: valorTotalVenta - valorTotalCompra,
      itemsSinStock: sinStock.length,
      itemsStockCritico: stockCritico.length,
      categorias: porCategoria.length,
    }

    return NextResponse.json({
      resumen,
      stockCritico,
      sinStock: sinStock.slice(0, 10),
      porCategoria,
      masValiosos,
      masVendidos,
    })
  } catch (error) {
    console.error("Error en análisis de inventario:", error)
    return NextResponse.json(
      { error: "Error al obtener análisis de inventario" },
      { status: 500 }
    )
  }
}
