import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { canEmitirFacturaElectronica } from "@/lib/facturacion/access"
import { decryptSecret } from "@/lib/facturacion/crypto"
import { tusFacturasProvider } from "@/lib/facturacion/tusfacturas-provider"
import { mapVentaToEmitirInput } from "@/lib/facturacion/map-venta"

export async function POST(request: Request) {
  const { error, organizationId } = await requireAdmin()
  if (error) return error

  // El toggle es una preferencia opt-in; se re-valida siempre server-side,
  // nunca se confía en que el cliente ya lo haya chequeado.
  if (!(await canEmitirFacturaElectronica(organizationId!))) {
    return NextResponse.json({ error: "Facturación electrónica no disponible" }, { status: 403 })
  }

  const { ventaId } = (await request.json().catch(() => ({}))) as { ventaId?: string }
  if (!ventaId) return NextResponse.json({ error: "Falta ventaId" }, { status: 400 })

  // Idempotencia: si ya existe un comprobante emitido para esta venta, no se
  // vuelve a emitir contra el proveedor.
  const { data: existing } = await supabaseAdmin
    .from("comprobantes_fiscales")
    .select("*")
    .eq("venta_id", ventaId)
    .eq("estado", "emitido")
    .maybeSingle()
  if (existing) return NextResponse.json({ comprobante: existing, yaEmitido: true }, { status: 409 })

  const { data: venta } = await supabaseAdmin
    .from("ventas")
    .select("*")
    .eq("id", ventaId)
    .eq("organization_id", organizationId!)
    .single()
  if (!venta) return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 })

  const { data: items } = await supabaseAdmin.from("items_venta").select("*").eq("venta_id", ventaId)
  const { data: cred } = await supabaseAdmin
    .from("facturacion_credenciales")
    .select("*")
    .eq("organization_id", organizationId!)
    .single()
  if (!cred) return NextResponse.json({ error: "Credenciales no configuradas" }, { status: 400 })

  // Los secretos se desencriptan recién acá, en memoria, para llamar al
  // proveedor; nunca se loguean ni se devuelven en la respuesta.
  const creds = {
    apitoken: decryptSecret(cred.apitoken_enc),
    apikey: decryptSecret(cred.apikey_enc),
    usertoken: decryptSecret(cred.usertoken_enc),
    puntoVenta: cred.punto_venta,
    condicionFiscal: cred.condicion_fiscal,
  }
  const input = mapVentaToEmitirInput(venta, items || [])

  const { data: pend } = await supabaseAdmin
    .from("comprobantes_fiscales")
    .insert({
      organization_id: organizationId!,
      venta_id: ventaId,
      tipo: creds.condicionFiscal === "MONOTRIBUTO" ? "C" : "B",
      punto_venta: creds.puntoVenta,
      estado: "pendiente",
      total: venta.total,
      receptor_doc_tipo: input.receptor.documentoTipo,
      receptor_doc_nro: input.receptor.documentoNro,
      receptor_condicion_iva: input.receptor.condicionIva,
    })
    .select("id")
    .single()

  const result = await tusFacturasProvider.emitir(creds, input)

  if (result.ok) {
    const { data: updated } = await supabaseAdmin
      .from("comprobantes_fiscales")
      .update({
        estado: "emitido",
        tipo: result.tipo,
        numero: result.numero,
        cae: result.cae,
        cae_vencimiento: result.caeVencimiento,
        pdf_url: result.pdfUrl,
        provider_response: result.raw as any,
        updated_at: new Date().toISOString(),
      })
      .eq("id", pend!.id)
      .select("*")
      .single()
    return NextResponse.json({ comprobante: updated }, { status: 200 })
  }

  const { data: rej } = await supabaseAdmin
    .from("comprobantes_fiscales")
    .update({
      estado: "rechazado",
      error_msg: (result.errores || []).join("; "),
      provider_response: result.raw as any,
      updated_at: new Date().toISOString(),
    })
    .eq("id", pend!.id)
    .select("*")
    .single()
  return NextResponse.json({ comprobante: rej, error: "Rechazado por el proveedor" }, { status: 422 })
}
