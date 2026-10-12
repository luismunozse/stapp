import { NextResponse } from "next/server"
import { requireAuth, lazyInventarioAccess } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import {
  getCookieSucursalId,
  resolveSucursalLectura,
  getDepositoDeSucursal,
  resolverDestinoVentaCacheado,
  derivarLecturaVenta,
  derivarAvisoAlcanceOrg,
  resolverIndicadorVentaCacheado,
} from "@/lib/sucursal"

// GET /api/inventario/search?q=term&limit=10
// Server-side search for inventory items (used by sale form)
// Returns minimal payload: id, codigo, nombre, stock, precioVenta
// If VENDEDOR (or ADMIN with sucursal cookie): filters to items with stock in that
// sucursal's principal deposito. ADMIN "ver todas" returns aggregate stock (original behavior).
// scope=venta (POS-only opt-in): ignores the "ver todas" selector and always scopes stock
// to the sucursal/deposito the sale will actually draw from (same resolution as the ventas
// write path), so what POS shows always matches what a sale can decrement. The resolved
// sucursal id is echoed back via the X-Venta-Sucursal-Id response header so the POS UI can show
// a "selling from" indicator without a second round trip; ventaInfo=true additionally resolves
// its name into X-Venta-Sucursal-Nombre (an extra query — only the POS mount fetch asks for it).
// That name is only emitted when the indicator is actually meaningful (resolverIndicadorVenta):
// an empty header means "do not show the indicator", which is a server-side decision because the
// browser can read neither the httpOnly sucursal cookie nor the org's sucursal count.
export async function GET(request: Request) {
  try {
    const { error, organizationId, role, session } = await requireAuth()
    if (error) return error

    // Purchase cost (precioCompra) follows the same rule as the rest of the
    // inventario endpoints: hasInventarioAccess (ADMIN always, VENDEDOR only
    // if the org opted in via vendedores_administran_inventario, TECNICO never).
    //
    // Resolved lazily: this route runs once per keystroke of the POS product
    // search, and the flag lives behind an uncached SELECT. It is awaited only
    // where the cost is written into the response, so a search that returns
    // nothing — or bails out before querying — costs no extra round trip.
    const canViewCost = lazyInventarioAccess(role, organizationId!)

    const { searchParams } = new URL(request.url)
    const q = searchParams.get("q") || ""
    const limit = Math.min(parseInt(searchParams.get("limit") || "10"), 50)
    const includeZeroStock = searchParams.get("includeZeroStock") === "true"
    const scopeVenta = searchParams.get("scope") === "venta"
    // Resolving the sucursal NAME costs an extra query, and only the POS mount
    // fetch consumes the X-Venta-Sucursal-Nombre header — the debounced
    // per-keystroke search does not. Opt in instead of paying it every time.
    const ventaInfo = searchParams.get("ventaInfo") === "true"

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
    let avisoAlcanceOrg = false

    if (scopeVenta) {
      // Cached: this route is the debounced per-keystroke search (see
      // lib/sucursal.ts for why the read path caches and the write path does not).
      const destino = await resolverDestinoVentaCacheado({
        role,
        organizationId: organizationId!,
        userSucursalId,
        cookieSucursalId,
      })
      const lectura = derivarLecturaVenta(destino)
      ventaSucursalId = lectura.ventaSucursalId
      sucursalId = lectura.sucursalId
      depositoIdPrefetched = lectura.depositoId
      verTodas = lectura.verTodas
      // Gratis (puro): el header sale en toda respuesta scope=venta, no solo
      // en la que pide ventaInfo.
      avisoAlcanceOrg = derivarAvisoAlcanceOrg({ role, cookieSucursalId, lectura })
      if (ventaInfo) {
        // The name doubles as the "should this indicator exist at all" signal:
        // the client cannot read the httpOnly cookie or count sucursales, so
        // the whole gate lives in resolverIndicadorVenta (see lib/sucursal.ts).
        ventaSucursalNombre = await resolverIndicadorVentaCacheado({
          role,
          organizationId: organizationId!,
          cookieSucursalId,
          ventaSucursalId: lectura.ventaSucursalId,
        })
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
        // "org" => la lectura (y la venta) abarcan toda la organización pese a
        // haber una sucursal concreta elegida en el selector. El POS lo dice en
        // pantalla porque nada más ahí puede explicarlo: el nombre viene vacío
        // justamente porque no hay una sola sucursal que nombrar sin mentir
        // (ver derivarAvisoAlcanceOrg en lib/sucursal.ts).
        res.headers.set("X-Venta-Alcance", avisoAlcanceOrg ? "org" : "")
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

      const rows = items || []
      const puedeVerCosto = rows.length > 0 ? await canViewCost() : false

      const formatted = rows.map((item) => ({
        id: item.id,
        codigo: item.codigo,
        nombre: item.nombre,
        stock: item.stock,
        stockReservado: item.stock_reservado ?? 0,
        precioVenta: item.precio_venta,
        precioCompra: puedeVerCosto ? (item.precio_compra ?? 0) : null,
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

    const rows = items || []
    const puedeVerCosto = rows.length > 0 ? await canViewCost() : false

    const formatted = rows.map((item: any) => {
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
        precioCompra: puedeVerCosto ? (item.precio_compra ?? 0) : null,
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
