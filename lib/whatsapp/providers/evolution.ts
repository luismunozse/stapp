/**
 * Cliente Evolution API (Baileys self-hosted).
 * Docs: https://doc.evolution-api.com
 *
 * Endpoints usados:
 *   POST /instance/create
 *   GET  /instance/connect/:instanceName       -> devuelve QR base64
 *   GET  /instance/connectionState/:instanceName
 *   DELETE /instance/logout/:instanceName
 *   DELETE /instance/delete/:instanceName
 *   POST /message/sendText/:instanceName       -> { number, text }
 */

export interface EvolutionCredentials {
  baseUrl: string
  apiKey: string
  instanceName: string
}

export interface EvolutionSendResult {
  success: boolean
  messageId?: string
  error?: string
}

export interface EvolutionConnectionState {
  state: "open" | "connecting" | "close" | "qr" | "unknown"
  qrBase64?: string
  pairingCode?: string
  error?: string
}

function buildUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`
}

async function evoFetch<T = unknown>(
  creds: EvolutionCredentials,
  path: string,
  init: RequestInit = {}
): Promise<{ ok: boolean; status: number; data: T | null; raw: string }> {
  const url = buildUrl(creds.baseUrl, path)
  const res = await fetch(url, {
    ...init,
    headers: {
      apikey: creds.apiKey,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  })

  const raw = await res.text()
  let data: T | null = null
  try {
    data = raw ? (JSON.parse(raw) as T) : null
  } catch {
    data = null
  }

  return { ok: res.ok, status: res.status, data, raw }
}

/**
 * Formatear telefono al formato Evolution: digitos puros con codigo pais.
 * Argentina default. Acepta entrada con o sin +, espacios, guiones, 15.
 */
export function formatPhoneNumber(phone: string): string {
  let cleaned = phone.replace(/\D/g, "")
  if (cleaned.startsWith("0")) cleaned = cleaned.substring(1)
  if (!cleaned.startsWith("54")) cleaned = "54" + cleaned
  cleaned = cleaned.replace(/^(54\d{2,4})15(\d{6,8})$/, "$1$2")
  return cleaned
}

/**
 * Crear instancia en Evolution. Idempotente desde el lado del caller:
 * si ya existe, devolvera 403/409 y debe tratarse como ok.
 */
export async function createInstance(creds: EvolutionCredentials): Promise<{
  success: boolean
  alreadyExists?: boolean
  error?: string
}> {
  try {
    const { ok, status, data, raw } = await evoFetch<{ instance?: unknown }>(
      creds,
      "/instance/create",
      {
        method: "POST",
        body: JSON.stringify({
          instanceName: creds.instanceName,
          qrcode: true,
          integration: "WHATSAPP-BAILEYS",
        }),
      }
    )

    if (ok) return { success: true }

    // 403/409 suele indicar instancia existente
    if (status === 403 || status === 409) {
      return { success: true, alreadyExists: true }
    }

    return {
      success: false,
      error: extractError(data) || `HTTP ${status}: ${raw.slice(0, 200)}`,
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Error de conexion" }
  }
}

/**
 * Pide QR / pairing code. Si el numero ya esta vinculado devuelve state=open.
 */
export async function connectInstance(
  creds: EvolutionCredentials
): Promise<EvolutionConnectionState> {
  try {
    const { ok, status, data, raw } = await evoFetch<{
      base64?: string
      code?: string
      pairingCode?: string
      qrcode?: { base64?: string; pairingCode?: string }
      instance?: { state?: string }
    }>(creds, `/instance/connect/${encodeURIComponent(creds.instanceName)}`, {
      method: "GET",
    })

    if (!ok) {
      return {
        state: "unknown",
        error: extractError(data) || `HTTP ${status}: ${raw.slice(0, 200)}`,
      }
    }

    const qrBase64 =
      data?.qrcode?.base64 || data?.base64 || (data?.code?.startsWith("data:image") ? data.code : undefined)
    const pairingCode = data?.qrcode?.pairingCode || data?.pairingCode

    if (data?.instance?.state === "open") {
      return { state: "open" }
    }

    return {
      state: qrBase64 ? "qr" : "connecting",
      qrBase64,
      pairingCode,
    }
  } catch (err) {
    return { state: "unknown", error: err instanceof Error ? err.message : "Error de conexion" }
  }
}

export async function getConnectionState(
  creds: EvolutionCredentials
): Promise<EvolutionConnectionState> {
  try {
    const { ok, status, data, raw } = await evoFetch<{
      instance?: { state?: string }
      state?: string
    }>(creds, `/instance/connectionState/${encodeURIComponent(creds.instanceName)}`, {
      method: "GET",
    })

    if (!ok) {
      return {
        state: "unknown",
        error: extractError(data) || `HTTP ${status}: ${raw.slice(0, 200)}`,
      }
    }

    const raw_state = (data?.instance?.state || data?.state || "unknown").toLowerCase()
    const state =
      raw_state === "open"
        ? "open"
        : raw_state === "connecting"
        ? "connecting"
        : raw_state === "close" || raw_state === "closed"
        ? "close"
        : "unknown"

    return { state }
  } catch (err) {
    return { state: "unknown", error: err instanceof Error ? err.message : "Error de conexion" }
  }
}

export async function logoutInstance(creds: EvolutionCredentials): Promise<{ success: boolean; error?: string }> {
  try {
    const { ok, status, data, raw } = await evoFetch(
      creds,
      `/instance/logout/${encodeURIComponent(creds.instanceName)}`,
      { method: "DELETE" }
    )
    if (ok) return { success: true }
    return { success: false, error: extractError(data) || `HTTP ${status}: ${raw.slice(0, 200)}` }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Error de conexion" }
  }
}

export async function deleteInstance(creds: EvolutionCredentials): Promise<{ success: boolean; error?: string }> {
  try {
    const { ok, status, data, raw } = await evoFetch(
      creds,
      `/instance/delete/${encodeURIComponent(creds.instanceName)}`,
      { method: "DELETE" }
    )
    if (ok || status === 404) return { success: true }
    return { success: false, error: extractError(data) || `HTTP ${status}: ${raw.slice(0, 200)}` }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Error de conexion" }
  }
}

export async function sendText(
  creds: EvolutionCredentials,
  to: string,
  text: string
): Promise<EvolutionSendResult> {
  try {
    const number = formatPhoneNumber(to)
    const { ok, status, data, raw } = await evoFetch<{
      key?: { id?: string }
      messageId?: string
    }>(creds, `/message/sendText/${encodeURIComponent(creds.instanceName)}`, {
      method: "POST",
      body: JSON.stringify({
        number,
        text,
      }),
    })

    if (!ok) {
      return {
        success: false,
        error: extractError(data) || `HTTP ${status}: ${raw.slice(0, 200)}`,
      }
    }

    return {
      success: true,
      messageId: data?.key?.id || data?.messageId,
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Error de conexion" }
  }
}

function extractError(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined
  const d = data as Record<string, unknown>
  if (typeof d.message === "string") return d.message
  if (typeof d.error === "string") return d.error
  if (Array.isArray(d.message)) return d.message.join("; ")
  if (d.response && typeof d.response === "object") {
    const r = d.response as Record<string, unknown>
    if (typeof r.message === "string") return r.message
  }
  return undefined
}
