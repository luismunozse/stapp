import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

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

// POST: Recibir eventos de WhatsApp (status updates, mensajes entrantes)
export async function POST(request: Request) {
  try {
    const body = await request.json()

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
  const normalizedText = text.trim().toLowerCase()
  const affirmativeWords = ["si", "sí", "dale", "ok", "aprobado", "acepto", "aprobar", "confirmo"]

  if (!affirmativeWords.some((w) => normalizedText.includes(w))) {
    return // No es una respuesta afirmativa
  }

  // Buscar la organización por phone_number_id
  const { data: config } = await supabaseAdmin
    .from("whatsapp_config")
    .select("organization_id")
    .eq("phone_number_id", phoneNumberId)
    .single()

  if (!config) return

  // Limpiar número para buscar cliente
  const cleanPhone = from.replace(/^54/, "").replace(/^15/, "")

  // Buscar cliente por teléfono
  const { data: clientes } = await supabaseAdmin
    .from("clientes")
    .select("id")
    .eq("organization_id", config.organization_id)
    .or(`telefono.ilike.%${cleanPhone}%`)
    .limit(1)

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

  // Auto-aprobar
  await supabaseAdmin
    .from("ordenes_servicio")
    .update({
      estado: "APROBADO",
      presupuesto_aprobado_portal: true,
      presupuesto_fecha_aprobacion: new Date().toISOString(),
    })
    .eq("id", orden.id)

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
