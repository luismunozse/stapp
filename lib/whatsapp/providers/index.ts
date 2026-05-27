/**
 * Dispatcher de providers de WhatsApp.
 * Carga la config de la organizacion y rutea el envio al backend correcto.
 */

import { supabaseAdmin } from "@/lib/supabase"
import { decrypt } from "@/lib/whatsapp/encryption"
import { sendTextMessage as metaSendText, sendTemplateMessage as metaSendTemplate, type TemplateComponent } from "@/lib/whatsapp/client"
import { sendText as evoSendText, type EvolutionCredentials } from "@/lib/whatsapp/providers/evolution"

export type WhatsAppProvider = "meta" | "evolution"

export interface SendResult {
  success: boolean
  messageId?: string
  error?: string
  provider?: WhatsAppProvider
}

interface ConfigRow {
  provider: WhatsAppProvider | null
  is_configured: boolean | null
  // meta
  phone_number_id: string | null
  access_token_encrypted: string | null
  // evolution
  evolution_base_url: string | null
  evolution_instance_name: string | null
  evolution_api_key_encrypted: string | null
}

async function loadConfig(organizationId: string): Promise<ConfigRow | null> {
  const { data } = await supabaseAdmin
    .from("whatsapp_config")
    .select(
      "provider, is_configured, phone_number_id, access_token_encrypted, evolution_base_url, evolution_instance_name, evolution_api_key_encrypted"
    )
    .eq("organization_id", organizationId)
    .single()
  return (data as ConfigRow | null) ?? null
}

export function getEvolutionCreds(config: ConfigRow): EvolutionCredentials | null {
  if (!config.evolution_base_url || !config.evolution_instance_name || !config.evolution_api_key_encrypted) {
    return null
  }
  return {
    baseUrl: config.evolution_base_url,
    instanceName: config.evolution_instance_name,
    apiKey: decrypt(config.evolution_api_key_encrypted),
  }
}

/**
 * Enviar mensaje de texto usando el provider configurado para la org.
 */
export async function sendWhatsAppText(
  organizationId: string,
  to: string,
  text: string
): Promise<SendResult> {
  const config = await loadConfig(organizationId)
  if (!config || !config.is_configured) {
    return { success: false, error: "WhatsApp no configurado" }
  }

  const provider: WhatsAppProvider = config.provider || "meta"

  if (provider === "evolution") {
    const creds = getEvolutionCreds(config)
    if (!creds) {
      return { success: false, error: "Evolution API incompleta (URL/instancia/api key)", provider }
    }
    const result = await evoSendText(creds, to, text)
    return { ...result, provider }
  }

  // Meta default
  if (!config.phone_number_id || !config.access_token_encrypted) {
    return { success: false, error: "Meta credenciales incompletas", provider }
  }
  const accessToken = decrypt(config.access_token_encrypted)
  const result = await metaSendText(config.phone_number_id, accessToken, to, text)
  return { ...result, provider }
}

/**
 * Enviar template aprobado. Solo disponible en Meta — Evolution usa texto libre.
 * Si la org tiene Evolution se hace fallback al body renderizado (caller debe pasar texto).
 */
export async function sendWhatsAppTemplate(
  organizationId: string,
  to: string,
  templateName: string,
  language: string,
  components?: TemplateComponent[],
  renderedFallbackText?: string
): Promise<SendResult> {
  const config = await loadConfig(organizationId)
  if (!config || !config.is_configured) {
    return { success: false, error: "WhatsApp no configurado" }
  }

  const provider: WhatsAppProvider = config.provider || "meta"

  if (provider === "evolution") {
    if (!renderedFallbackText) {
      return { success: false, error: "Evolution no soporta templates; falta texto renderizado", provider }
    }
    const creds = getEvolutionCreds(config)
    if (!creds) {
      return { success: false, error: "Evolution API incompleta", provider }
    }
    const result = await evoSendText(creds, to, renderedFallbackText)
    return { ...result, provider }
  }

  if (!config.phone_number_id || !config.access_token_encrypted) {
    return { success: false, error: "Meta credenciales incompletas", provider }
  }
  const accessToken = decrypt(config.access_token_encrypted)
  const result = await metaSendTemplate(
    config.phone_number_id,
    accessToken,
    to,
    templateName,
    language,
    components
  )
  return { ...result, provider }
}

export async function getProviderForOrg(organizationId: string): Promise<WhatsAppProvider | null> {
  const config = await loadConfig(organizationId)
  if (!config || !config.is_configured) return null
  return (config.provider || "meta") as WhatsAppProvider
}
