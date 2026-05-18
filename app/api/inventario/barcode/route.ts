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
    const rawCode = searchParams.get("code")
    const code = (rawCode ?? "").trim()

    if (!code) {
      return NextResponse.json({ error: "Código requerido" }, { status: 400 })
    }

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

    return NextResponse.json({
      found: true,
      code,
      matchedByCodigo,
      item: formatInventario(item),
    })
  } catch (error) {
    console.error("Error searching by barcode:", error)
    return NextResponse.json({ error: "Error al buscar por código de barras" }, { status: 500 })
  }
}
