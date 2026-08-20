import { NextResponse } from "next/server"
import { requireAuth, hasInventarioAccess, resolveVendedoresHabilitados } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

// GET /api/inventario/check-duplicate?nombre=...&tipo=...&categoria=...&excludeId=...
// Señal suave de duplicado para la UX. Devuelve items similares por nombre
// (fuzzy match por tokens) dentro de la misma organización, preferentemente
// del mismo tipo si se indica.
// No bloquea la creación; el frontend decide cómo mostrarlo.
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function tokenize(s: string): string[] {
  return normalize(s)
    .split(" ")
    .filter((t) => t.length >= 2)
}

// Score entre 0 y 1. Combina Jaccard (simetría) y containment (cuánto del
// nombre ingresado aparece en el candidato). Tokens largos pesan más que los
// cortos para evitar falsos positivos con números sueltos.
function similarity(queryTokens: string[], candTokens: string[]): number {
  if (queryTokens.length === 0 || candTokens.length === 0) return 0

  const weight = (t: string) => (t.length >= 4 ? 1 : 0.5)
  const qWeights = new Map<string, number>()
  const cWeights = new Map<string, number>()
  queryTokens.forEach((t) => qWeights.set(t, weight(t)))
  candTokens.forEach((t) => cWeights.set(t, weight(t)))

  let shared = 0
  let qTotal = 0
  let cTotal = 0
  for (const [t, w] of qWeights) qTotal += w
  for (const [t, w] of cWeights) cTotal += w
  for (const [t, w] of qWeights) {
    if (cWeights.has(t)) shared += Math.min(w, cWeights.get(t)!)
  }

  const jaccard = shared / (qTotal + cTotal - shared)
  const containment = shared / qTotal
  return Math.max(jaccard, containment * 0.85)
}

export async function GET(request: Request) {
  try {
    const { error, organizationId, role } = await requireAuth()
    if (error) return error

    const vendedoresHabilitados = role === "VENDEDOR"
      ? await resolveVendedoresHabilitados(organizationId!)
      : false
    const canViewCost = hasInventarioAccess(role, vendedoresHabilitados)

    const { searchParams } = new URL(request.url)
    const nombre = searchParams.get("nombre")?.trim() || ""
    const tipo = searchParams.get("tipo") || ""
    const categoria = searchParams.get("categoria") || ""
    const excludeId = searchParams.get("excludeId") || ""

    const queryTokens = tokenize(nombre)
    if (queryTokens.length === 0) {
      return NextResponse.json({ matches: [] })
    }

    let query = supabaseAdmin
      .from("inventario")
      .select(
        "id, codigo, nombre, categoria, tipo_dispositivo, stock, precio_compra, precio_venta, proveedor_id, proveedores:proveedor_id(id, nombre)"
      )
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .limit(500)

    if (tipo) query = query.eq("tipo_dispositivo", tipo)
    if (excludeId) query = query.neq("id", excludeId)

    const { data, error: dbError } = await query
    if (dbError) throw dbError

    const THRESHOLD = 0.5

    const scored = (data || [])
      .map((row) => {
        const cTokens = tokenize(row.nombre)
        const score = similarity(queryTokens, cTokens)
        // Boost si además coincide la categoría (si se pasó)
        const boosted = categoria && row.categoria === categoria ? score + 0.05 : score
        return { row, score: boosted }
      })
      .filter((r) => r.score >= THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)

    const matches = scored.map(({ row, score }) => ({
      id: row.id,
      codigo: row.codigo,
      nombre: row.nombre,
      categoria: row.categoria,
      tipoDispositivo: row.tipo_dispositivo,
      stock: row.stock,
      precioCompra: canViewCost ? row.precio_compra : null,
      precioVenta: row.precio_venta,
      proveedor: (row.proveedores as { nombre?: string } | null)?.nombre || null,
      score: Math.round(score * 100) / 100,
    }))

    return NextResponse.json({ matches })
  } catch (err) {
    console.error("Error checking duplicates:", err)
    return NextResponse.json({ error: "Error al verificar duplicados" }, { status: 500 })
  }
}
