import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { formatInventario } from "@/lib/db-utils"
import { getCookieSucursalId, resolveSucursalLectura, getDepositoDeSucursal } from "@/lib/sucursal"

// GET /api/inventario/search?q=term&limit=10
// Server-side search for inventory items (used by sale form)
// Returns minimal payload: id, codigo, nombre, stock, precioVenta
// If VENDEDOR (or ADMIN with sucursal cookie): filters to items with stock in that
// sucursal's principal deposito. ADMIN "ver todas" returns aggregate stock (original behavior).
export async function GET(request: Request) {
  try {
    const { error, organizationId, role, session } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const q = searchParams.get("q") || ""
    const limit = Math.min(parseInt(searchParams.get("limit") || "10"), 50)
    const includeZeroStock = searchParams.get("includeZeroStock") === "true"

    // Resolve sucursal scope
    const cookieSucursalId = await getCookieSucursalId()
    const userSucursalId = session?.user?.sucursalId ?? null
    const { sucursalId, verTodas } = resolveSucursalLectura({
      role,
      userSucursalId,
      cookieSucursalId,
    })

    // Sanitize query terms for ILIKE filter
    const terms = q
      .trim()
      .split(/\s+/)
      .map((t) => t.replace(/[%_,()*\\]/g, "").trim())
      .filter(Boolean)
      .slice(0, 6)

    if (verTodas || !sucursalId) {
      // ADMIN "ver todas": aggregate stock, original behavior
      let query = supabaseAdmin
        .from("inventario")
        .select("id, codigo, nombre, stock, stock_reservado, precio_venta, precio_compra, trackea_series, dias_garantia_default")
        .eq("organization_id", organizationId!)
        .is("deleted_at", null)

      if (!includeZeroStock) {
        query = query.gt("stock", 0)
      }

      query = query.order("nombre", { ascending: true }).limit(limit)

      for (const term of terms) {
        query = query.or(`nombre.ilike.%${term}%,codigo.ilike.%${term}%`)
      }

      const { data: items, error: dbError } = await query
      if (dbError) throw dbError

      const formatted = (items || []).map((item) => ({
        id: item.id,
        codigo: item.codigo,
        nombre: item.nombre,
        stock: item.stock,
        stockReservado: item.stock_reservado ?? 0,
        precioVenta: item.precio_venta,
        // Cost data hidden from TECNICO (cotización item search leaks margin
        // otherwise). VENDEDOR/ADMIN unchanged — this endpoint is also used by
        // POS, which is out of scope for this gate.
        precioCompra: role === "TECNICO" ? null : (item.precio_compra ?? 0),
        trackeaSeries: item.trackea_series ?? false,
        diasGarantiaDefault: (item as any).dias_garantia_default ?? null,
      }))

      return NextResponse.json(formatted)
    }

    // Sucursal-scoped: resolve the principal deposito of this sucursal
    const depId = await getDepositoDeSucursal(organizationId!, sucursalId)

    if (!depId) {
      // No principal deposito configured for this sucursal — return empty
      return NextResponse.json([])
    }

    // Query inventario joined with inventario_depositos for this specific deposito.
    // Use !inner to ensure only items that have a row in inventario_depositos for depId.
    // PostgREST column filter on embedded resource: eq("inventario_depositos.deposito_id", depId)
    let query = supabaseAdmin
      .from("inventario")
      .select(
        "id, codigo, nombre, precio_venta, precio_compra, trackea_series, dias_garantia_default, inventario_depositos!inner(stock, stock_reservado, deposito_id)"
      )
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .eq("inventario_depositos.deposito_id", depId)

    if (!includeZeroStock) {
      query = query.gt("inventario_depositos.stock", 0)
    }

    query = query.order("nombre", { ascending: true }).limit(limit)

    for (const term of terms) {
      query = query.or(`nombre.ilike.%${term}%,codigo.ilike.%${term}%`)
    }

    const { data: items, error: dbError } = await query
    if (dbError) throw dbError

    const formatted = (items || []).map((item: any) => {
      // inventario_depositos is an array when using !inner embed; take first row
      const depRow = Array.isArray(item.inventario_depositos)
        ? item.inventario_depositos[0]
        : item.inventario_depositos
      const stock = depRow?.stock ?? 0
      const stockReservado = depRow?.stock_reservado ?? 0
      return {
        id: item.id,
        codigo: item.codigo,
        nombre: item.nombre,
        stock,
        stockReservado,
        precioVenta: item.precio_venta,
        precioCompra: role === "TECNICO" ? null : (item.precio_compra ?? 0),
        trackeaSeries: item.trackea_series ?? false,
        diasGarantiaDefault: item.dias_garantia_default ?? null,
      }
    })

    return NextResponse.json(formatted)
  } catch (error) {
    console.error("Error searching inventario:", error)
    return NextResponse.json(
      { error: "Error al buscar items de inventario" },
      { status: 500 }
    )
  }
}
