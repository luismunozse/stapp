import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { stockDisponibleCatalogo } from "@/lib/catalogo/stock-disponible"

/**
 * Diagnóstico de stock de un item del catálogo público.
 *
 * Uso: GET /api/catalogo/diagnose?q=Bateria%20iPhone
 *
 * Devuelve TODOS los items que matchean el nombre (case-insensitive), con
 * el desglose de stock: catalogo_items.stock, inventario.stock, variantes.
 * Útil cuando el stock mostrado no coincide con lo esperado: típicamente
 * hay items duplicados, stock linkeado a inventario o variantes con 0.
 */
export async function GET(req: Request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const url = new URL(req.url)
  const q = (url.searchParams.get("q") || "").trim()
  if (q.length < 2) {
    return NextResponse.json({ error: "Pasá ?q=<nombre>" }, { status: 400 })
  }

  const { data: items, error } = await supabaseAdmin
    .from("catalogo_items")
    .select(`
      id, nombre, activo, stock, inventario_id,
      inventario:inventario(id, nombre, stock, stock_reservado),
      variantes:catalogo_variantes(id, etiqueta, stock, activo)
    `)
    .eq("organization_id", auth.organizationId!)
    .ilike("nombre", `%${q}%`)
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const report = (items ?? []).map((it: any) => {
    const variantesActivas: any[] = (it.variantes ?? []).filter((v: any) => v.activo)
    const tieneVariantes = variantesActivas.length > 0
    const stockVariantesTotal = tieneVariantes
      ? variantesActivas.reduce((s, v) => (v.stock == null ? s : s + v.stock), 0)
      : null
    // Mismo helper que el storefront: si esto no coincidiera con la página, la
    // herramienta hecha para explicar discrepancias produciría una.
    const stockEfectivo = tieneVariantes
      ? stockVariantesTotal
      : stockDisponibleCatalogo(it)

    // El embed puede venir vacío aunque inventario_id esté cargado: el producto
    // fue borrado en soft, o el link quedó apuntando a una fila que ya no está.
    // Guardarse sólo por inventario_id tiraba TypeError y devolvía 500 — justo
    // el caso que esta herramienta existe para explicar.
    const inv = it.inventario ?? null
    const reservado = inv?.stock_reservado ?? 0

    return {
      id: it.id,
      nombre: it.nombre,
      activo: it.activo,
      catalogo_items_stock: it.stock,
      inventario_linked: it.inventario_id
        ? inv
          ? {
              id: inv.id,
              nombre: inv.nombre,
              // Desglose: el público ve stock - reservado, así que hace falta
              // ver las dos mitades para entender de dónde sale el número.
              stock_fisico: inv.stock,
              stock_reservado: reservado,
            }
          : { id: it.inventario_id, roto: "el producto vinculado no existe o fue borrado" }
        : null,
      variantes_activas: variantesActivas.map((v) => ({
        id: v.id,
        etiqueta: v.etiqueta,
        stock: v.stock,
      })),
      stock_efectivo_publico: stockEfectivo,
      donde_editar:
        tieneVariantes
          ? "EN_VARIANTES (item tiene variantes activas)"
          : it.inventario_id
            ? "EN_INVENTARIO (item linkeado a inventario)"
            : "EN_ITEM (stock propio)",
      // Causa mas comun de "el stock fisico no es cero pero el catalogo dice
      // agotado": hay reservas tomadas y todavia sin liberar.
      nota_reservas:
        !tieneVariantes && reservado > 0
          ? `${reservado} unidad(es) reservadas por cotizaciones sin cerrar`
          : null,
    }
  })

  return NextResponse.json({
    query: q,
    cantidad: report.length,
    items: report,
  })
}
