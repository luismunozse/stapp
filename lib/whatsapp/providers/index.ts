/**
 * Dispatcher de providers de WhatsApp.
 * Carga la config de la organizacion y rutea el envio al backend correcto.
 */

import { supabaseAdmin } from "@/lib/supabase"
import { decrypt } from "@/lib/whatsapp/encryption"
import { getPlatformEvolutionConfig } from "@/lib/whatsapp/platform-config"
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

/**
 * País de la organización (código ISO, ej. "AR", "CR"). Se usa para formatear
 * el número al código de país correcto antes de enviar. Si no está definido,
 * el formateo cae a Argentina por defecto.
 */
async function loadOrgCountry(organizationId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("organizations")
    .select("pais")
    .eq("id", organizationId)
    .single()
  return (data?.pais as string | null) ?? null
}

export function getEvolutionCreds(config: ConfigRow): EvolutionCredentials | null {
  const platform = getPlatformEvolutionConfig()
  if (!platform || !config.evolution_instance_name) {
    return null
  }
  return {
    baseUrl: platform.baseUrl,
    instanceName: config.evolution_instance_name,
    apiKey: platform.apiKey,
  }
}

/**
 * Enviar mensaje de texto usando el provider configurado para la org.
 */
export async function sendWhatsAppText(
  organizationId: string,
  to: string,
  text: string,
  opts?: { instanceNameOverride?: string }
): Promise<SendResult> {
  // Override por sucursal: enviar por Evolution con una instancia específica,
  // usando las credenciales de plataforma. No lee whatsapp_config (central).
  if (opts?.instanceNameOverride) {
    const platform = getPlatformEvolutionConfig()
    if (!platform) {
      return { success: false, error: "Plataforma Evolution no configurada", provider: "evolution" }
    }
    const countryCode = await loadOrgCountry(organizationId)
    const creds = {
      baseUrl: platform.baseUrl,
      instanceName: opts.instanceNameOverride,
      apiKey: platform.apiKey,
    }
    const result = await evoSendText(creds, to, text, countryCode)
    return { ...result, provider: "evolution" }
  }

  const config = await loadConfig(organizationId)
  if (!config || !config.is_configured) {
    return { success: false, error: "WhatsApp no configurado" }
  }

  const provider: WhatsAppProvider = config.provider || "meta"
  const countryCode = await loadOrgCountry(organizationId)

  if (provider === "evolution") {
    const creds = getEvolutionCreds(config)
    if (!creds) {
      return { success: false, error: "Evolution API incompleta (URL/instancia/api key)", provider }
    }
    const result = await evoSendText(creds, to, text, countryCode)
    return { ...result, provider }
  }

  // Meta default
  if (!config.phone_number_id || !config.access_token_encrypted) {
    return { success: false, error: "Meta credenciales incompletas", provider }
  }
  const accessToken = decrypt(config.access_token_encrypted)
  const result = await metaSendText(config.phone_number_id, accessToken, to, text, countryCode)
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
  const countryCode = await loadOrgCountry(organizationId)

  if (provider === "evolution") {
    if (!renderedFallbackText) {
      return { success: false, error: "Evolution no soporta templates; falta texto renderizado", provider }
    }
    const creds = getEvolutionCreds(config)
    if (!creds) {
      return { success: false, error: "Evolution API incompleta", provider }
    }
    const result = await evoSendText(creds, to, renderedFallbackText, countryCode)
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
    components,
    countryCode
  )
  return { ...result, provider }
}

export async function getProviderForOrg(organizationId: string): Promise<WhatsAppProvider | null> {
  const config = await loadConfig(organizationId)
  if (!config || !config.is_configured) return null
  return (config.provider || "meta") as WhatsAppProvider
}
