/**
 * Lease con TTL como primitiva de concurrencia para facturación ARCA
 * directa (design ADR-02).
 *
 * STApp no tiene sesión directa a Postgres en runtime — todo pasa por
 * PostgREST vía supabaseAdmin, que confirma (commitea) la transacción de
 * cada RPC apenas esta retorna. Un pg_advisory_xact_lock tomado dentro de
 * una `.rpc()` no puede cubrir una sección crítica que incluye una llamada
 * HTTP a AFIP de varios segundos. Por eso la corrección NO depende del
 * advisory lock (que solo vive dentro de las RPCs de la migración 298),
 * sino de esta tabla de leases: primary key + fencing por holder.
 */

import crypto from "crypto"
import { supabaseAdmin } from "@/lib/supabase"

export class LeaseAcquisitionError extends Error {
  constructor(lockKey: string) {
    super(`No se pudo adquirir el lease '${lockKey}' tras los reintentos`)
    this.name = "LeaseAcquisitionError"
  }
}

export interface WithLeaseOptions {
  lockKey: string
  organizationId: string
  ttlSeconds: number
  /** Cantidad de intentos de adquisición no bloqueantes. Default 5 (design ADR-02). */
  retries?: number
  /** Rango de jitter entre reintentos en ms. Default 200-2000 (design ADR-02). */
  minDelayMs?: number
  maxDelayMs?: number
  /** Inyectable para tests — evita esperas reales. */
  sleep?: (ms: number) => Promise<void>
}

const DEFAULT_RETRIES = 5
const DEFAULT_MIN_DELAY_MS = 200
const DEFAULT_MAX_DELAY_MS = 2000

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function jitterDelay(minMs: number, maxMs: number): number {
  return minMs + Math.random() * (maxMs - minMs)
}

async function acquireLease(
  lockKey: string,
  organizationId: string,
  holder: string,
  ttlSeconds: number
): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("facturacion_lease_acquire", {
    p_lock_key: lockKey,
    p_org_id: organizationId,
    p_holder: holder,
    p_ttl_seconds: ttlSeconds,
  })
  if (error) {
    throw new Error(`Error adquiriendo lease '${lockKey}': ${error.message}`)
  }
  return data === true
}

async function releaseLease(lockKey: string, holder: string): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc("facturacion_lease_release", {
    p_lock_key: lockKey,
    p_holder: holder,
  })
  if (error) {
    // No relanzamos desde el finally: el TTL igual expira y el error ya
    // habría enmascarado el resultado real de fn().
    console.error(`[facturacion/arca/lease] error liberando lease '${lockKey}':`, error.message)
    return
  }
  if (data !== true) {
    // El lease ya no era nuestro al liberar (expiró por TTL y otro worker lo
    // tomó) — es el fencing funcionando como se espera, no un error.
    console.warn(
      `[facturacion/arca/lease] lease '${lockKey}' ya no pertenecía a este holder al liberar (fencing/TTL)`
    )
  }
}

/**
 * Ejecuta `fn` bajo un lease no bloqueante sobre `lockKey`. Reintenta la
 * adquisición con jitter; si agota los reintentos, lanza
 * `LeaseAcquisitionError` sin ejecutar `fn`. Libera el lease en un
 * `finally`, fenced por holder (un uuid generado una vez por llamada).
 */
export async function withLease<T>(options: WithLeaseOptions, fn: () => Promise<T>): Promise<T> {
  const {
    lockKey,
    organizationId,
    ttlSeconds,
    retries = DEFAULT_RETRIES,
    minDelayMs = DEFAULT_MIN_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    sleep = defaultSleep,
  } = options

  const holder = crypto.randomUUID()
  let acquired = false

  for (let attempt = 0; attempt < retries; attempt++) {
    acquired = await acquireLease(lockKey, organizationId, holder, ttlSeconds)
    if (acquired) break
    if (attempt < retries - 1) {
      await sleep(jitterDelay(minDelayMs, maxDelayMs))
    }
  }

  if (!acquired) {
    throw new LeaseAcquisitionError(lockKey)
  }

  try {
    return await fn()
  } finally {
    await releaseLease(lockKey, holder)
  }
}

/** Clave de lease para la renovación del ticket WSAA (design ADR-02). */
export function wsaaLockKey(
  organizationId: string,
  cuit: string,
  service: string,
  production: boolean
): string {
  return `wsaa:${organizationId}:${cuit}:${service}:${production ? "p" : "h"}`
}

/** Clave de lease para la línea de numeración de emisión (design ADR-02). */
export function emisionLockKey(organizationId: string, puntoVenta: number, cbteTipoAfip: number): string {
  return `emis:${organizationId}:${puntoVenta}:${cbteTipoAfip}`
}
