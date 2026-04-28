import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { formatInventario } from "@/lib/db-utils"

// GET /api/inventario/barcode?code=123456
// Search inventory by barcode
export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const code = searchParams.get("code")

    if (!code) {
      return NextResponse.json({ error: "Código requerido" }, { status: 400 })
    }

    // Search by barcode first, fallback to codigo (products may store EAN in either field)
    let item = null
    const { data: byBarcode, error: barcodeErr } = await supabaseAdmin
      .from("inventario")
      .select("*, proveedores:proveedor_id(id, nombre)")
      .eq("organization_id", organizationId!)
      .eq("barcode", code)
      .is("deleted_at", null)
      .maybeSingle()
    if (barcodeErr) throw barcodeErr
    item = byBarcode

    if (!item) {
      const { data: byCodigo, error: codigoErr } = await supabaseAdmin
        .from("inventario")
        .select("*, proveedores:proveedor_id(id, nombre)")
        .eq("organization_id", organizationId!)
        .eq("codigo", code)
        .is("deleted_at", null)
        .maybeSingle()
      if (codigoErr) throw codigoErr
      item = byCodigo
    }

    if (!item) {
      return NextResponse.json({ found: false, code })
    }

    return NextResponse.json({ found: true, code, item: formatInventario(item) })
  } catch (error) {
    console.error("Error searching by barcode:", error)
    return NextResponse.json({ error: "Error al buscar por código de barras" }, { status: 500 })
  }
}
