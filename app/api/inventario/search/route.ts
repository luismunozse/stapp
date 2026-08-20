import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { formatInventario } from "@/lib/db-utils"
import {
  getCookieSucursalId,
  resolveSucursalLectura,
  getDepositoDeSucursal,
  resolverDestinoVenta,
  getNombreSucursal,
} from "@/lib/sucursal"

// GET /api/inventario/search?q=term&limit=10
// Server-side search for inventory items (used by sale form)
// Returns minimal payload: id, codigo, nombre, stock, precioVenta
// If VENDEDOR (or ADMIN with sucursal cookie): filters to items with stock in that
// sucursal's principal deposito. ADMIN "ver todas" returns aggregate stock (original behavior).
// scope=venta (POS-only opt-in): ignores the "ver todas" selector and always scopes stock
// to the sucursal/deposito the sale will actually draw from (same resolution as the ventas
// write path), so what POS shows always matches what a sale can decrement. The resolved
// sucursal id/name are echoed back via X-Venta-Sucursal-Id/-Nombre response headers so the
// POS UI can show a "selling from" indicator without a second round trip.
export async function GET(request: Request) {
  try {
    const { error, organizationId, role, session } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const q = searchParams.get("q") || ""
    const limit = Math.min(parseInt(searchParams.get("limit") || "10"), 50)
    const includeZeroStock = searchParams.get("includeZeroStock") === "true"
    const scopeVenta = searchParams.get("scope") === "venta"

    // Resolve sucursal scope. Under scope=venta, ignore the reader's "ver
    // todas" cookie state entirely and resolve the concrete sale target
    // instead — this is what makes POS reads agree with the ventas write path.
    const cookieSucursalId = await getCookieSucursalId()
    const userSucursalId = session?.user?.sucursalId ?? null

    let sucursalId: string | null
    let verTodas: boolean
    let depositoIdPrefetched: string | null = null
    let ventaSucursalId: string | null = null
    let ventaSucursalNombre: string | null = null

    if (scopeVenta) {
      const destino = await resolverDestinoVenta({ role, organizationId: organizationId!, userSucursalId })
      ventaSucursalId = destino.sucursalId
      sucursalId = destino.sucursalId
      depositoIdPrefetched = destino.depositoId
      // No concrete deposito (org without principal sucursal, or sucursal
      // without principal deposito): the write path passes p_deposito_id = null
      // and drains org-wide, so the catalog must mirror that org-wide aggregate
      // instead of going empty for stock the sale could actually decrement.
      verTodas = !destino.depositoId
      if (destino.sucursalId) {
        ventaSucursalNombre = await getNombreSucursal(organizationId!, destino.sucursalId)
      }
    } else {
      const resolved = resolveSucursalLectura({ role, userSucursalId, cookieSucursalId })
      sucursalId = resolved.sucursalId
      verTodas = resolved.verTodas
    }

    const withVentaHeaders = (res: NextResponse) => {
      if (scopeVenta) {
        res.headers.set("X-Venta-Sucursal-Id", ventaSucursalId ?? "")
        res.headers.set(
          "X-Venta-Sucursal-Nombre",
          ventaSucursalNombre ? encodeURIComponent(ventaSucursalNombre) : ""
        )
      }
      return res
    }

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
        precioCompra: item.precio_compra ?? 0,
        trackeaSeries: item.trackea_series ?? false,
        diasGarantiaDefault: (item as any).dias_garantia_default ?? null,
      }))

      return withVentaHeaders(NextResponse.json(formatted))
    }

    // Sucursal-scoped: resolve the principal deposito of this sucursal
    // (already resolved above under scope=venta — avoid a duplicate query).
    const depId = scopeVenta ? depositoIdPrefetched : await getDepositoDeSucursal(organizationId!, sucursalId)

    if (!depId) {
      // No principal deposito configured for this sucursal — return empty
      return withVentaHeaders(NextResponse.json([]))
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
        precioCompra: item.precio_compra ?? 0,
        trackeaSeries: item.trackea_series ?? false,
        diasGarantiaDefault: item.dias_garantia_default ?? null,
      }
    })

    return withVentaHeaders(NextResponse.json(formatted))
  } catch (error) {
    console.error("Error searching inventario:", error)
    return NextResponse.json(
      { error: "Error al buscar items de inventario" },
      { status: 500 }
    )
  }
}
