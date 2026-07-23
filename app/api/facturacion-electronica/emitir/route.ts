import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { canEmitirFacturaElectronica } from "@/lib/facturacion/access"
import { decryptSecret } from "@/lib/facturacion/crypto"
import { tusFacturasProvider } from "@/lib/facturacion/tusfacturas-provider"
import { mapVentaToEmitirInput } from "@/lib/facturacion/map-venta"

// Columnas seguras para devolver un comprobante al cliente. NUNCA incluir
// provider_response acá: es la respuesta cruda del proveedor y puede traer
// datos internos que no corresponde exponer.
const SAFE_COLUMNS =
  "id, venta_id, tipo, punto_venta, numero, cae, cae_vencimiento, estado, pdf_url, receptor_doc_tipo, receptor_doc_nro, receptor_condicion_iva, total, provider, error_msg, created_at, updated_at"

// Código de Postgres para violación de constraint UNIQUE.
const UNIQUE_VIOLATION = "23505"

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

  // Idempotencia amigable: si ya existe un comprobante emitido para esta
  // venta (org-scoped), no se vuelve a emitir contra el proveedor. Esto es
  // solo un atajo de UX; la garantía real contra la carrera vive en el
  // índice único parcial de la migración (uq_comprobante_venta_activo),
  // aplicado más abajo en el INSERT.
  const { data: existing, error: existingErr } = await supabaseAdmin
    .from("comprobantes_fiscales")
    .select(SAFE_COLUMNS)
    .eq("venta_id", ventaId)
    .eq("organization_id", organizationId!)
    .eq("estado", "emitido")
    .maybeSingle()
  if (existingErr) {
    return NextResponse.json({ error: "No se pudo verificar el comprobante" }, { status: 500 })
  }
  if (existing) return NextResponse.json({ comprobante: existing, yaEmitido: true }, { status: 409 })

  const { data: venta, error: ventaErr } = await supabaseAdmin
    .from("ventas")
    .select("*")
    .eq("id", ventaId)
    .eq("organization_id", organizationId!)
    .single()
  if (ventaErr || !venta) return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 })

  const { data: items, error: itemsErr } = await supabaseAdmin
    .from("items_venta")
    .select("*")
    .eq("venta_id", ventaId)
  if (itemsErr) {
    return NextResponse.json({ error: "No se pudieron cargar los items de la venta" }, { status: 500 })
  }

  const { data: cred, error: credErr } = await supabaseAdmin
    .from("facturacion_credenciales")
    .select("*")
    .eq("organization_id", organizationId!)
    .single()
  if (credErr) return NextResponse.json({ error: "No se pudieron cargar las credenciales" }, { status: 500 })
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

  // El INSERT es el gate real contra la carrera: el índice único parcial
  // uq_comprobante_venta_activo (estado IN ('pendiente','emitido')) rechaza
  // un segundo comprobante activo para la misma venta a nivel DB, sin
  // importar cuántos requests concurrentes pasaron el chequeo amigable de
  // arriba.
  const { data: pend, error: insErr } = await supabaseAdmin
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

  if (insErr) {
    if (insErr.code === UNIQUE_VIOLATION) {
      // Otro request ya está emitiendo (o ya emitió) esta venta: no se llama
      // al proveedor, se devuelve el comprobante activo existente.
      const { data: active, error: activeErr } = await supabaseAdmin
        .from("comprobantes_fiscales")
        .select(SAFE_COLUMNS)
        .eq("venta_id", ventaId)
        .eq("organization_id", organizationId!)
        .in("estado", ["pendiente", "emitido"])
        .maybeSingle()
      if (activeErr) {
        return NextResponse.json({ error: "Comprobante en proceso o ya emitido" }, { status: 409 })
      }
      return NextResponse.json({ comprobante: active, yaEmitido: true }, { status: 409 })
    }
    return NextResponse.json({ error: "No se pudo iniciar el comprobante" }, { status: 500 })
  }
  if (!pend) {
    return NextResponse.json({ error: "No se pudo iniciar el comprobante" }, { status: 500 })
  }

  let result
  try {
    result = await tusFacturasProvider.emitir(creds, input)
  } catch (err) {
    // No dejamos un comprobante "pendiente" colgado: si el proveedor tira
    // una excepción (timeout, red, etc.), lo marcamos rechazado para que se
    // pueda reintentar.
    const { error: catchUpdErr } = await supabaseAdmin
      .from("comprobantes_fiscales")
      .update({
        estado: "rechazado",
        error_msg: err instanceof Error ? err.message : "Error desconocido al emitir",
        updated_at: new Date().toISOString(),
      })
      .eq("id", pend.id)
    if (catchUpdErr) {
      // No se confirmó el rechazo y acá nunca hubo CAE (el proveedor tiró
      // una excepción antes de responder): dejar el "pendiente" colgado
      // bloquearía la venta para siempre contra el índice único parcial, así
      // que se borra para liberarla y permitir reintentar.
      await supabaseAdmin.from("comprobantes_fiscales").delete().eq("id", pend.id)
      return NextResponse.json({ error: "No se pudo emitir (error del proveedor)" }, { status: 502 })
    }
    return NextResponse.json({ error: "Error al emitir el comprobante" }, { status: 422 })
  }

  if (result.ok) {
    const { data: updated, error: updErr } = await supabaseAdmin
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
      .eq("id", pend.id)
      .select(SAFE_COLUMNS)
      .single()
    if (updErr) {
      // El proveedor SÍ emitió un CAE real acá: nunca se borra el pendiente
      // (perderíamos la única referencia a esa emisión). Se loguea todo lo
      // necesario para reconciliar el registro a mano.
      console.error("[facturacion] emitido pero fallo el update", {
        ventaId,
        cae: result.cae,
        numero: result.numero,
      })
      return NextResponse.json(
        { error: "No se pudo registrar el comprobante emitido", cae: result.cae, numero: result.numero },
        { status: 500 }
      )
    }
    return NextResponse.json({ comprobante: updated }, { status: 200 })
  }

  const { data: rej, error: rejErr } = await supabaseAdmin
    .from("comprobantes_fiscales")
    .update({
      estado: "rechazado",
      error_msg: (result.errores || []).join("; "),
      provider_response: result.raw as any,
      updated_at: new Date().toISOString(),
    })
    .eq("id", pend.id)
    .select(SAFE_COLUMNS)
    .single()
  if (rejErr) {
    // Tampoco acá hubo CAE (el proveedor respondió ok:false): mismo
    // razonamiento que en el catch de arriba, se borra el pendiente para no
    // dejar la venta bloqueada contra el índice único parcial.
    await supabaseAdmin.from("comprobantes_fiscales").delete().eq("id", pend.id)
    return NextResponse.json({ error: "No se pudo registrar el rechazo" }, { status: 500 })
  }
  return NextResponse.json({ comprobante: rej, error: "Rechazado por el proveedor" }, { status: 422 })
}
