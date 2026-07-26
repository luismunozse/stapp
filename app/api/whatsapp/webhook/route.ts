import { NextResponse } from "next/server"
import { createHmac, timingSafeEqual } from "crypto"
import { supabaseAdmin } from "@/lib/supabase"
import { transicionarOrden } from "@/lib/orden-transicion"

// GET: Verificación del webhook por Meta
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get("hub.mode")
  const token = searchParams.get("hub.verify_token")
  const challenge = searchParams.get("hub.challenge")

  if (mode !== "subscribe" || !token || !challenge) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 })
  }

  // Buscar organización con este verify token
  const { data } = await supabaseAdmin
    .from("whatsapp_config")
    .select("id")
    .eq("webhook_verify_token", token)
    .single()

  if (!data) {
    return NextResponse.json({ error: "Invalid token" }, { status: 403 })
  }

  // Responder con el challenge para verificar
  return new NextResponse(challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  })
}

/**
 * Verify Meta's X-Hub-Signature-256 HMAC signature.
 * Returns true only when the signature matches.
 * Exported for unit-testing.
 */
export function verifyMetaSignature(rawBody: string, signatureHeader: string, appSecret: string): boolean {
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex")
  const received = signatureHeader.startsWith("sha256=") ? signatureHeader.slice(7) : signatureHeader

  // Guard equal length before timingSafeEqual (it throws on length mismatch)
  if (expected.length !== received.length) return false

  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"))
}

// POST: Recibir eventos de WhatsApp (status updates, mensajes entrantes)
export async function POST(request: Request) {
  // ── Fix 1: HMAC signature verification ──────────────────────────────────
  const appSecret = process.env.WHATSAPP_APP_SECRET
  if (!appSecret) {
    console.error("[whatsapp/webhook] WHATSAPP_APP_SECRET is not configured — refusing to process")
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 })
  }

  const signatureHeader = request.headers.get("x-hub-signature-256")
  if (!signatureHeader) {
    return NextResponse.json({ error: "Missing signature" }, { status: 401 })
  }

  // Read raw body ONCE — needed for both HMAC verification and JSON parsing
  const rawBody = await request.text()

  if (!verifyMetaSignature(rawBody, signatureHeader, appSecret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }
  // ────────────────────────────────────────────────────────────────────────

  try {
    const body = JSON.parse(rawBody)

    // Procesar cada entry
    const entries = body.entry || []
    for (const entry of entries) {
      const changes = entry.changes || []
      for (const change of changes) {
        const value = change.value

        // Status updates
        if (value.statuses) {
          for (const status of value.statuses) {
            await supabaseAdmin
              .from("whatsapp_messages")
              .update({
                status: status.status, // sent, delivered, read, failed
                error_code: status.errors?.[0]?.code,
                error_message: status.errors?.[0]?.message,
              })
              .eq("whatsapp_message_id", status.id)
          }
        }

        // Mensajes entrantes
        if (value.messages) {
          for (const message of value.messages) {
            if (message.type === "text") {
              await processIncomingMessage(
                value.metadata?.phone_number_id,
                message.from,
                message.text?.body || ""
              )
            }
          }
        }
      }
    }

    return NextResponse.json({ status: "ok" })
  } catch (err) {
    console.error("Error processing WA webhook:", err)
    return NextResponse.json({ status: "ok" }) // Siempre 200 para Meta
  }
}

/**
 * Procesar mensaje entrante del cliente.
 * Si responde afirmativamente a un presupuesto pendiente, auto-aprobar.
 */
async function processIncomingMessage(
  phoneNumberId: string,
  from: string,
  text: string
) {
  // ── Fix 2: word-boundary affirmative matching ──────────────────────────
  // Normalize: lowercase, strip diacritics, then tokenize on non-letter chars.
  // A word is affirmative only when it is an EXACT token match, not a substring.
  const normalized = text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics (e.g. í → i)

  const tokens = normalized.split(/[^a-z]+/).filter(Boolean)

  // "sí" normalizes to "si" via NFD accent stripping above — no need to list both
  const affirmativeWords = ["si", "dale", "ok", "aprobado", "acepto", "aprobar", "confirmo"]

  // A token is affirmative only when it is an exact match AND neither of the
  // two preceding tokens is a negation/hedging word.
  // "casi" (= almost) is treated as a hedge. Checking a 2-token window handles
  // "casi lo confirmo" (casi is 2 positions before confirmo).
  const negationWords = ["no", "nunca", "jamas", "tampoco", "casi"]
  const hasAffirmative = tokens.some((token, idx) => {
    if (!affirmativeWords.includes(token)) return false
    const window = tokens.slice(Math.max(0, idx - 2), idx)
    if (window.some((t) => negationWords.includes(t))) return false
    return true
  })

  if (!hasAffirmative) {
    return // Not an affirmative response
  }
  // ────────────────────────────────────────────────────────────────────────

  // Buscar la organización por phone_number_id
  const { data: config } = await supabaseAdmin
    .from("whatsapp_config")
    .select("organization_id")
    .eq("phone_number_id", phoneNumberId)
    .single()

  if (!config) return

  // Limpiar número para buscar cliente
  const cleanPhone = from.replace(/^54/, "").replace(/^15/, "")

  // ── Fix 3: ends-with phone match to reduce false collisions ─────────────
  // Using ends-with (%cleanPhone) instead of contains (%cleanPhone%) so that
  // "1100000000" doesn't match a number like "2211000000009". This is
  // minimal and safe: stored phones are normalized without country prefix,
  // so the subscriber's digits always appear at the END of the stored value.
  const { data: clientes } = await supabaseAdmin
    .from("clientes")
    .select("id")
    .eq("organization_id", config.organization_id)
    .or(`telefono.ilike.%${cleanPhone}`)
    .limit(1)
  // ────────────────────────────────────────────────────────────────────────

  if (!clientes || clientes.length === 0) return

  // Buscar orden PRESUPUESTADA de este cliente
  const { data: orden } = await supabaseAdmin
    .from("ordenes_servicio")
    .select("id, numero_orden")
    .eq("organization_id", config.organization_id)
    .eq("cliente_id", clientes[0].id)
    .eq("estado", "PRESUPUESTADO")
    .order("fecha_ingreso", { ascending: false })
    .limit(1)
    .single()

  if (!orden) return

  // Auto-aprobar: transición atómica PRESUPUESTADO -> APROBADO. Si la orden ya
  // no está en ese estado (race), no-op silencioso — el bot no tiene una UX de
  // error que mostrar, así que no emitimos evento.
  const resultado = await transicionarOrden(supabaseAdmin, {
    ordenId: orden.id,
    organizationId: config.organization_id,
    esperado: "PRESUPUESTADO",
    nuevo: "APROBADO",
    camposExtra: {
      presupuesto_aprobado_portal: true,
      presupuesto_fecha_aprobacion: new Date().toISOString(),
    },
  })

  if (!resultado.ok) return

  // Registrar evento
  await supabaseAdmin.from("orden_eventos").insert({
    orden_id: orden.id,
    organization_id: config.organization_id,
    tipo: "PRESUPUESTO_APROBADO",
    estado_anterior: "PRESUPUESTADO",
    estado_nuevo: "APROBADO",
    descripcion: "Presupuesto aprobado por el cliente via WhatsApp",
    metadata: { aprobadoDesdeWhatsApp: true, from },
  })
}
