/**
 * Cliente para WhatsApp Business Cloud API (Meta).
 * Documentación: https://developers.facebook.com/docs/whatsapp/cloud-api
 */

const WA_API_BASE = "https://graph.facebook.com/v18.0"

interface SendMessageResult {
  success: boolean
  messageId?: string
  error?: string
}

export interface TemplateComponent {
  type: "body" | "header" | "button"
  parameters: Array<{
    type: "text" | "image" | "document"
    text?: string
    image?: { link: string }
  }>
}

/**
 * Enviar un mensaje de template aprobado.
 */
export async function sendTemplateMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  templateName: string,
  language: string = "es",
  components?: TemplateComponent[]
): Promise<SendMessageResult> {
  try {
    const body: Record<string, unknown> = {
      messaging_product: "whatsapp",
      to: formatPhoneNumber(to),
      type: "template",
      template: {
        name: templateName,
        language: { code: language },
        ...(components ? { components } : {}),
      },
    }

    const res = await fetch(`${WA_API_BASE}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })

    const data = await res.json()

    if (!res.ok) {
      return {
        success: false,
        error: data.error?.message || `HTTP ${res.status}`,
      }
    }

    return {
      success: true,
      messageId: data.messages?.[0]?.id,
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    }
  }
}

/**
 * Enviar un mensaje de texto libre (solo dentro de ventana de 24h).
 */
export async function sendTextMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  text: string
): Promise<SendMessageResult> {
  try {
    const body = {
      messaging_product: "whatsapp",
      to: formatPhoneNumber(to),
      type: "text",
      text: { body: text },
    }

    const res = await fetch(`${WA_API_BASE}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })

    const data = await res.json()

    if (!res.ok) {
      return {
        success: false,
        error: data.error?.message || `HTTP ${res.status}`,
      }
    }

    return {
      success: true,
      messageId: data.messages?.[0]?.id,
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    }
  }
}

/**
 * Verificar que las credenciales son válidas.
 */
export async function verifyCredentials(
  phoneNumberId: string,
  accessToken: string
): Promise<{ valid: boolean; phoneName?: string; error?: string }> {
  try {
    const res = await fetch(`${WA_API_BASE}/${phoneNumberId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    const data = await res.json()

    if (!res.ok) {
      return { valid: false, error: data.error?.message || "Credenciales inválidas" }
    }

    return {
      valid: true,
      phoneName: data.verified_name || data.display_phone_number,
    }
  } catch (err) {
    return { valid: false, error: "Error de conexión" }
  }
}

/**
 * Formatear número de teléfono argentino al formato internacional.
 */
function formatPhoneNumber(phone: string): string {
  // Remover caracteres no numéricos
  let cleaned = phone.replace(/\D/g, "")

  // Si empieza con 0, remover
  if (cleaned.startsWith("0")) {
    cleaned = cleaned.substring(1)
  }

  // Si no tiene código de país, agregar Argentina (54)
  if (!cleaned.startsWith("54")) {
    cleaned = "54" + cleaned
  }

  // Si tiene 15 después del código de área, removerlo (formato viejo)
  cleaned = cleaned.replace(/^(54\d{2,4})15(\d{6,8})$/, "$1$2")

  return cleaned
}
