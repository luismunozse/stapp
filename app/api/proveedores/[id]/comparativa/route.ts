import { NextResponse } from "next/server"
import { requireAdminOrVendedor, hasInventarioAccess, resolveVendedoresHabilitados } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

// GET /api/proveedores/[id]/comparativa
// Compara precios de items de este proveedor contra los mismos códigos
// vendidos por OTROS proveedores en el inventario. Sólo retorna códigos
// que existen en ≥2 proveedores distintos.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Mismo eje que el resto del namespace: ver el comentario en
    // app/api/proveedores/route.ts.
    const { error, organizationId, role } = await requireAdminOrVendedor()
    if (error) return error
    const { id } = await params

    const vendedoresHabilitados = role === "VENDEDOR"
      ? await resolveVendedoresHabilitados(organizationId!)
      : false
    const canViewCost = hasInventarioAccess(role, vendedoresHabilitados)

    const { data: prov } = await supabaseAdmin
      .from("proveedores")
      .select("id, nombre")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()
    if (!prov) {
      return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 })
    }

    const { data: items, error: dbErr } = await supabaseAdmin
      .from("inventario")
      .select("id, codigo, nombre, stock, precio_compra, precio_venta, proveedor_id, proveedores:proveedor_id(id, nombre)")
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .not("proveedor_id", "is", null)
      .limit(10000)

    if (dbErr) throw dbErr

    type Row = {
      id: string
      codigo: string
      nombre: string
      stock: number
      precio_compra: number | null
      precio_venta: number | null
      proveedor_id: string
      proveedores: { id: string; nombre: string } | null
    }
    const rows = (items || []) as unknown as Row[]

    // Codigos del proveedor target
    const myCodigos = new Set<string>()
    for (const r of rows) {
      if (r.proveedor_id === id && r.codigo) myCodigos.add(r.codigo)
    }

    // Agrupar por codigo (sólo los que tiene este proveedor)
    const groups = new Map<string, Row[]>()
    for (const r of rows) {
      if (!r.codigo || !myCodigos.has(r.codigo)) continue
      if (!groups.has(r.codigo)) groups.set(r.codigo, [])
      groups.get(r.codigo)!.push(r)
    }

    const result: Array<{
      codigo: string
      nombre: string
      mine: {
        itemId: string
        precioCompra: number | null
        precioVenta: number | null
        stock: number
      } | null
      others: Array<{
        proveedorId: string
        proveedorNombre: string
        itemId: string
        precioCompra: number | null
        precioVenta: number | null
        stock: number
      }>
      minPrecioCompra: number | null
      mineIsCheapest: boolean
    }> = []

    for (const [codigo, list] of groups) {
      const distinct = new Set(list.map((r) => r.proveedor_id))
      if (distinct.size < 2) continue

      const mineRow = list.find((r) => r.proveedor_id === id) || null
      const others = list.filter((r) => r.proveedor_id !== id)

      const prices = list
        .map((r) => (r.precio_compra != null ? Number(r.precio_compra) : null))
        .filter((p): p is number => p != null && p > 0)
      const min = prices.length ? Math.min(...prices) : null

      result.push({
        codigo,
        nombre: mineRow?.nombre || list[0].nombre,
        mine: mineRow
          ? {
              itemId: mineRow.id,
              precioCompra: canViewCost && mineRow.precio_compra != null ? Number(mineRow.precio_compra) : null,
              precioVenta: mineRow.precio_venta != null ? Number(mineRow.precio_venta) : null,
              stock: mineRow.stock || 0,
            }
          : null,
        others: others.map((r) => ({
          proveedorId: r.proveedor_id,
          proveedorNombre: r.proveedores?.nombre || "—",
          itemId: r.id,
          precioCompra: canViewCost && r.precio_compra != null ? Number(r.precio_compra) : null,
          precioVenta: r.precio_venta != null ? Number(r.precio_venta) : null,
          stock: r.stock || 0,
        })),
        minPrecioCompra: canViewCost ? min : null,
        mineIsCheapest: canViewCost &&
          min != null && mineRow?.precio_compra != null && Number(mineRow.precio_compra) === min,
      })
    }

    result.sort((a, b) => a.codigo.localeCompare(b.codigo, "es"))

    return NextResponse.json(
      {
        proveedor: { id: prov.id, nombre: prov.nombre },
        items: result,
      },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (err) {
    console.error("Error en comparativa proveedor:", err)
    return NextResponse.json({ error: "Error al calcular comparativa" }, { status: 500 })
  }
}
