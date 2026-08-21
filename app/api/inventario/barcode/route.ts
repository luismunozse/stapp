import { NextResponse } from "next/server"
import { requireAuth, hasInventarioAccess, resolveVendedoresHabilitados } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { formatInventario } from "@/lib/db-utils"
import { getCookieSucursalId, resolveSucursalLectura, getDepositoDeSucursal } from "@/lib/sucursal"

// GET /api/inventario/barcode?code=123456
// Search inventory by barcode
// If VENDEDOR (or ADMIN with sucursal cookie): returns stock from that sucursal's
// principal deposito. If 0 there, stock=0 is returned so the POS rejects it.
// ADMIN "ver todas" returns the aggregate stock field as before.
export async function GET(request: Request) {
  try {
    const { error, organizationId, role, session } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const rawCode = searchParams.get("code")
    const code = (rawCode ?? "").trim()

    if (!code) {
      return NextResponse.json({ error: "Código requerido" }, { status: 400 })
    }

    // Resolve sucursal scope for stock reporting
    const cookieSucursalId = await getCookieSucursalId()
    const userSucursalId = session?.user?.sucursalId ?? null
    const { sucursalId, verTodas } = resolveSucursalLectura({
      role,
      userSucursalId,
      cookieSucursalId,
    })

    // Search by barcode first, fallback to codigo (products may store EAN in either field).
    // Usamos ILIKE para match case-insensitive: códigos Code 128 alfanuméricos
    // cargados manualmente pueden quedar en distinta caja que el escaneo.
    // Escapamos los wildcards (% _) para que ILIKE haga match exacto.
    // Usamos limit(1) en vez de maybeSingle() porque pueden existir filas con
    // diferente caja (ABC vs abc); priorizamos un resultado consistente sobre
    // un error 500 cuando hay duplicados.
    const escapedCode = code.replace(/[%_\\]/g, "\\$&")
    let item = null
    let matchedByCodigo = false
    const { data: barcodeMatches, error: barcodeErr } = await supabaseAdmin
      .from("inventario")
      .select("*, proveedores:proveedor_id(id, nombre)")
      .eq("organization_id", organizationId!)
      .ilike("barcode", escapedCode)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
    if (barcodeErr) throw barcodeErr
    item = barcodeMatches?.[0] ?? null

    if (!item) {
      const { data: codigoMatches, error: codigoErr } = await supabaseAdmin
        .from("inventario")
        .select("*, proveedores:proveedor_id(id, nombre)")
        .eq("organization_id", organizationId!)
        .ilike("codigo", escapedCode)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .limit(1)
      if (codigoErr) throw codigoErr
      item = codigoMatches?.[0] ?? null
      if (item) matchedByCodigo = true
    }

    if (!item) {
      return NextResponse.json({ found: false, code })
    }

    // Format the item using the standard formatter (includes aggregate stock).
    // item is guaranteed non-null at this point (guarded above).
    //
    // Purchase cost (precioCompra) follows hasInventarioAccess, like the rest of
    // the inventario read endpoints: this route guards with plain requireAuth(),
    // so a TECNICO reaches it. Dropping the cost for everyone is NOT an option:
    // the inventory list scanner feeds this exact object into the edit dialog
    // and the form PUTs it back, so a null cost for an ADMIN would be persisted
    // as 0. The role lookup only costs a round-trip for VENDEDOR.
    const vendedoresHabilitados = role === "VENDEDOR"
      ? await resolveVendedoresHabilitados(organizationId!)
      : false
    const canViewCost = hasInventarioAccess(role, vendedoresHabilitados)
    const formattedItem = formatInventario(item, canViewCost)!

    // If scoped to a sucursal, override stock with the per-deposito value
    if (!verTodas && sucursalId) {
      const depId = await getDepositoDeSucursal(organizationId!, sucursalId)
      if (depId) {
        const { data: depRow } = await supabaseAdmin
          .from("inventario_depositos")
          .select("stock, stock_reservado")
          .eq("inventario_id", item.id)
          .eq("deposito_id", depId)
          .maybeSingle()
        formattedItem.stock = depRow?.stock ?? 0
        formattedItem.stockReservado = depRow?.stock_reservado ?? 0
      } else {
        // No principal deposito for this sucursal — treat as 0 stock
        formattedItem.stock = 0
        formattedItem.stockReservado = 0
      }
    }

    return NextResponse.json({
      found: true,
      code,
      matchedByCodigo,
      item: formattedItem,
    })
  } catch (error) {
    console.error("Error searching by barcode:", error)
    return NextResponse.json({ error: "Error al buscar por código de barras" }, { status: 500 })
  }
}
