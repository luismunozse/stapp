import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

// GET /api/inventario/check-duplicate?nombre=...&tipo=...&categoria=...&excludeId=...
// Señal suave de duplicado para la UX: devuelve items con el mismo nombre normalizado
// (lowercase, trim, sin acentos, espacios colapsados) dentro del mismo tipo+categoría.
// No bloquea la creación; el frontend decide si mostrar aviso o dejar crear.
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const nombre = searchParams.get("nombre")?.trim() || ""
    const tipo = searchParams.get("tipo") || ""
    const categoria = searchParams.get("categoria") || ""
    const excludeId = searchParams.get("excludeId") || ""

    if (nombre.length < 2 || !tipo || !categoria) {
      return NextResponse.json({ matches: [] })
    }

    const normalized = normalize(nombre)

    let query = supabaseAdmin
      .from("inventario")
      .select("id, codigo, nombre, stock, precio_compra, precio_venta, proveedor_id, proveedores:proveedor_id(id, nombre)")
      .eq("organization_id", organizationId!)
      .eq("tipo_dispositivo", tipo)
      .eq("categoria", categoria)
      .is("deleted_at", null)
      .limit(10)

    if (excludeId) {
      query = query.neq("id", excludeId)
    }

    const { data, error: dbError } = await query
    if (dbError) throw dbError

    const matches = (data || [])
      .filter((row) => normalize(row.nombre) === normalized)
      .map((row) => ({
        id: row.id,
        codigo: row.codigo,
        nombre: row.nombre,
        stock: row.stock,
        precioCompra: row.precio_compra,
        precioVenta: row.precio_venta,
        proveedor: (row.proveedores as { nombre?: string } | null)?.nombre || null,
      }))

    return NextResponse.json({ matches })
  } catch (err) {
    console.error("Error checking duplicates:", err)
    return NextResponse.json({ error: "Error al verificar duplicados" }, { status: 500 })
  }
}
