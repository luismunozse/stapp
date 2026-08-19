/**
 * Cache de tickets WSAA (token + sign) sobre `wsaa_tickets` (migración 298),
 * con la forma que un `ITicketStoragePort` de `@arcasdk/core` necesita
 * (design ADR-05). El paquete `@arcasdk/core` todavía no está instalado —
 * el spike de homologación (tasks Phase 0) es el que confirma la firma
 * exacta del puerto — así que este módulo implementa la forma documentada
 * (read/write con margen + renovación con double-checked locking) sin
 * depender del SDK. La llamada real de login WSAA se inyecta como callback
 * (`login`) para que un PR posterior (Phase 4, ArcaDirectProvider) la
 * conecte al SDK sin tocar este archivo.
 *
 * El SDK por defecto escribe su store en `node_modules/`, que en Vercel es
 * de solo lectura — este puerto sobre Supabase es obligatorio, no una
 * optimización.
 */

import { supabaseAdmin } from "@/lib/supabase"
import { encryptSecret, decryptSecret } from "@/lib/facturacion/crypto"
import { withLease, LeaseAcquisitionError, wsaaLockKey } from "@/lib/facturacion/arca/lease"

export interface WsaaTicketKey {
  organizationId: string
  cuit: string
  service: string
  production: boolean
}

export interface WsaaTicket {
  token: string
  sign: string
  /** ISO timestamp — expiración del ticket según el header de AFIP. */
  expiresAt: string
  generatedAt?: string
}

/** Margen de seguridad: un ticket a menos de 10 min de expirar se trata como miss (design ADR-05). */
const WSAA_MARGIN_MS = 10 * 60 * 1000
/** Piso anti-tight-loop: no reintentar un login WSAA antes de este tiempo del intento previo. */
const DEFAULT_LOGIN_FLOOR_MS = 60 * 1000
/** TTL del lease de renovación WSAA (design ADR-02: 45s). */
const DEFAULT_LEASE_TTL_SECONDS = 45

export class WsaaLoginRateLimitedError extends Error {
  constructor(key: WsaaTicketKey) {
    super(
      `Login WSAA para ${key.organizationId}/${key.cuit}/${key.service} throttled: intento previo demasiado reciente`
    )
    this.name = "WsaaLoginRateLimitedError"
  }
}

export class WsaaLoginUnavailableError extends Error {
  constructor(key: WsaaTicketKey) {
    super(
      `No se pudo renovar el ticket WSAA para ${key.organizationId}/${key.cuit}/${key.service}: lease ocupado y ningún worker publicó un ticket válido`
    )
    this.name = "WsaaLoginUnavailableError"
  }
}

interface RawRow {
  token_enc: string | null
  sign_enc: string | null
  expires_at: string
  generated_at: string | null
  ultimo_login_intento_at?: string | null
}

async function selectRow(key: WsaaTicketKey): Promise<RawRow | null> {
  const { data, error } = await supabaseAdmin
    .from("wsaa_tickets")
    .select("token_enc, sign_enc, expires_at, generated_at, ultimo_login_intento_at")
    .eq("organization_id", key.organizationId)
    .eq("cuit", key.cuit)
    .eq("service", key.service)
    .eq("production", key.production)
    .maybeSingle()

  if (error) {
    throw new Error(`Error leyendo wsaa_tickets: ${error.message}`)
  }
  return (data as RawRow | null) ?? null
}

/**
 * Lee el ticket cacheado. El margen de 10 minutos vive ACÁ (no en el SDK):
 * un ticket todavía técnicamente vigente pero dentro del margen se reporta
 * como miss para forzar la renovación antes de que AFIP lo rechace.
 *
 * Una fila con secretos NULL (creada por `stampLoginAttempt` para registrar
 * un intento de login sin ticket propio todavía) siempre se trata como "sin
 * ticket válido", sin importar qué diga `expires_at` — no depende de que ese
 * campo también "parezca viejo" (review PR1, hallazgo P1).
 */
export async function readWsaaTicket(key: WsaaTicketKey): Promise<WsaaTicket | null> {
  const row = await selectRow(key)
  if (!row) return null
  if (!row.token_enc || !row.sign_enc) return null
  if (new Date(row.expires_at).getTime() - Date.now() <= WSAA_MARGIN_MS) return null
  return {
    token: decryptSecret(row.token_enc),
    sign: decryptSecret(row.sign_enc),
    expiresAt: row.expires_at,
    generatedAt: row.generated_at ?? undefined,
  }
}

/** Persiste (upsert) un ticket renovado, cifrado at-rest. */
export async function writeWsaaTicket(key: WsaaTicketKey, ticket: WsaaTicket): Promise<void> {
  const generatedAt = ticket.generatedAt ?? new Date().toISOString()
  const { error } = await supabaseAdmin.from("wsaa_tickets").upsert(
    {
      organization_id: key.organizationId,
      cuit: key.cuit,
      service: key.service,
      production: key.production,
      token_enc: encryptSecret(ticket.token),
      sign_enc: encryptSecret(ticket.sign),
      expires_at: ticket.expiresAt,
      generated_at: generatedAt,
      // Va en el MISMO upsert que el ticket: si writeWsaaTicket se llama sin
      // un stampLoginAttempt previo (p.ej. fila nueva), el piso anti-tight-
      // loop queda persistido de una — no en NULL hasta el próximo ciclo de
      // renovación (review PR1, hallazgo P1: PostgREST deja en NULL, en el
      // INSERT branch de un upsert, cualquier columna ausente del payload).
      ultimo_login_intento_at: generatedAt,
    },
    { onConflict: "organization_id,cuit,service,production" }
  )

  if (error) {
    throw new Error(`Error guardando wsaa_tickets: ${error.message}`)
  }
}

/**
 * Registra (upsert) el intento de login ANTES de llamar a AFIP, para que el
 * piso de 60s tenga dónde persistir incluso si es el primer login de una
 * credencial que todavía nunca tuvo éxito (review PR1, hallazgo P1: antes
 * era un UPDATE-only, que es un no-op sin fila previa — cero protección de
 * piso en los reintentos secuenciales del onboarding/troubleshooting).
 *
 * NUNCA manda token_enc/sign_enc: al omitir ambos (nunca uno solo), la fila
 * queda con los dos en NULL en el INSERT branch, satisfaciendo el CHECK
 * `wsaa_tickets_secretos_conjuntos`. Sobre una fila EXISTENTE con ticket
 * real, el UPDATE branch de un upsert solo toca las columnas presentes en
 * el payload — token_enc/sign_enc quedan intactos.
 *
 * `expires_at` sí viaja (requerido: NOT NULL sin default) — clavarlo a
 * "ahora" en una fila existente es inofensivo acá: solo se llega a este
 * punto después de que la doble lectura (ADR-05) ya determinó que el ticket
 * vigente, si lo hay, está stale/dentro del margen.
 */
async function stampLoginAttempt(key: WsaaTicketKey, when: Date): Promise<void> {
  const { error } = await supabaseAdmin.from("wsaa_tickets").upsert(
    {
      organization_id: key.organizationId,
      cuit: key.cuit,
      service: key.service,
      production: key.production,
      ultimo_login_intento_at: when.toISOString(),
      expires_at: when.toISOString(),
    },
    { onConflict: "organization_id,cuit,service,production" }
  )

  if (error) {
    throw new Error(`Error registrando intento de login WSAA: ${error.message}`)
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface RenewWsaaTicketOptions {
  key: WsaaTicketKey
  /** Login WSAA real — inyectado; Phase 4 lo conecta a `@arcasdk/core`. */
  login: () => Promise<{ token: string; sign: string; expiresAt: string }>
  now?: () => Date
  loginFloorMs?: number
  leaseTtlSeconds?: number
  /** Reintentos de re-lectura cuando el lease está ocupado (fallback del paso 6, ADR-05). */
  rereadAttempts?: number
  rereadDelayMs?: number
  sleep?: (ms: number) => Promise<void>
}

/**
 * Renovación con double-checked locking (design ADR-05):
 *   1. Lee. Vigente más allá del margen -> usarlo, sin lock.
 *   2. Miss -> adquiere el lease `wsaa:{org}:{cuit}:{service}:{prod}`.
 *   3. Re-lee dentro del lease -> otro worker pudo haber renovado ya.
 *   4. Sigue stale -> piso de 60s (`ultimo_login_intento_at`).
 *   5. Login inyectado + persistencia; el lease se libera en el finally de withLease.
 *   6. Si no se puede adquirir el lease tras los reintentos: sleep-and-reread
 *      unas veces (el ganador publica en segundos); si nada aparece, falla.
 *
 * Nota (deviation, ver reporte de apply): el manejo especial de
 * `coe.alreadyAuthenticated` (paso 7 de ADR-05) depende del código de error
 * real de `@arcasdk/core`, no confirmado sin el spike — queda para Phase 4.
 */
export async function renewWsaaTicket(options: RenewWsaaTicketOptions): Promise<WsaaTicket> {
  const {
    key,
    login,
    now = () => new Date(),
    loginFloorMs = DEFAULT_LOGIN_FLOOR_MS,
    leaseTtlSeconds = DEFAULT_LEASE_TTL_SECONDS,
    rereadAttempts = 3,
    rereadDelayMs = 1000,
    sleep = defaultSleep,
  } = options

  const cached = await readWsaaTicket(key)
  if (cached) return cached

  try {
    return await withLease(
      {
        lockKey: wsaaLockKey(key.organizationId, key.cuit, key.service, key.production),
        organizationId: key.organizationId,
        ttlSeconds: leaseTtlSeconds,
        sleep,
      },
      async () => {
        const reread = await readWsaaTicket(key)
        if (reread) return reread

        const raw = await selectRow(key)
        if (raw?.ultimo_login_intento_at) {
          const elapsedMs = now().getTime() - new Date(raw.ultimo_login_intento_at).getTime()
          if (elapsedMs < loginFloorMs) {
            throw new WsaaLoginRateLimitedError(key)
          }
        }

        await stampLoginAttempt(key, now())

        const result = await login()
        const ticket: WsaaTicket = {
          token: result.token,
          sign: result.sign,
          expiresAt: result.expiresAt,
          generatedAt: now().toISOString(),
        }
        await writeWsaaTicket(key, ticket)
        return ticket
      }
    )
  } catch (err) {
    if (!(err instanceof LeaseAcquisitionError)) throw err

    for (let i = 0; i < rereadAttempts; i++) {
      await sleep(rereadDelayMs)
      const found = await readWsaaTicket(key)
      if (found) return found
    }
    throw new WsaaLoginUnavailableError(key)
  }
}
