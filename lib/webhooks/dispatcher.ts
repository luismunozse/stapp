import { createHmac, randomBytes } from "crypto"
import { supabaseAdmin } from "@/lib/supabase"

// ============================================
// EVENT TYPES
// ============================================
// Single source of truth. UI lo lee para multi-select. APIs validan contra él.
// NUEVO evento → agregar acá + documentar payload type abajo.

export const EVENT_TYPES = [
  "inventario.created",
  "inventario.updated",
  "inventario.archived",
  // Disclaimer: NO se dispara desde el trigger SQL (notify_stock_bajo_on_movimiento).
  // Se emite en lugar de eso desde el endpoint de ajuste de stock cuando
  // stock_posterior <= punto_reorden. Trade-off: simplifica (sin LISTEN/NOTIFY
  // ni cron) a costa de no capturar caídas por movimientos creados via SQL directo.
  "inventario.stock_bajo",
  "venta.completada",
  "orden.estado_cambiado",
  "cotizacion.aceptada",
  // Reservado: el endpoint /test fuerza este evento sin requerir suscripción.
  "webhook.test",
] as const

export type EventType = (typeof EVENT_TYPES)[number]

// ============================================
// PAYLOAD SHAPES (docs)
// ============================================
// Tipos no se validan en runtime — son contrato con el consumidor.
// JSON.stringify del payload entero pasa al body del POST.

export interface InventarioCreatedPayload {
  id: string
  codigo: string
  nombre: string
  categoria: string
  tipoDispositivo: string
  stock: number
  precioVenta: number
  precioCompra: number
  proveedorId: string | null
  barcode: string | null
}

export interface InventarioUpdatedPayload {
  id: string
  codigo: string
  nombre: string
  // Campos que cambiaron + valores antes/después
  changes: Record<string, { before: unknown; after: unknown }>
}

export interface InventarioArchivedPayload {
  id: string
  codigo: string
  nombre: string
  archivedBy: string | null
}

export interface InventarioStockBajoPayload {
  id: string
  codigo: string
  nombre: string
  stock: number
  puntoReorden: number | null
  stockMinimo: number | null
}

export interface VentaCompletadaPayload {
  id: string
  numeroVenta: number | null
  clienteNombre: string
  total: number
  metodoPago: string
  items: number
}

export interface OrdenEstadoCambiadoPayload {
  id: string
  numeroOrden: number | null
  estadoAnterior: string
  estadoNuevo: string
  dispositivo: string | null
  clienteId: string | null
}

export interface CotizacionAceptadaPayload {
  id: string
  numeroCotizacion: number | null
  tipo: string
  total: number
  clienteId: string | null
  ordenId: string | null
}

export interface WebhookTestPayload {
  message: string
  at: string
}

// ============================================
// PUBLIC API
// ============================================

/**
 * Genera secret aleatorio para HMAC. 32 bytes = 64 hex chars.
 * El cliente lo guarda y usa para verificar X-Webhook-Signature.
 */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString("hex")
}

/**
 * Emite un evento a todos los webhooks activos suscriptos.
 *
 * Fire-and-forget: NO se await en el caller. Inserta deliveries PENDING
 * en una sola query y dispara cada POST en paralelo sin bloquear.
 * Cualquier error queda en webhook_deliveries.status='FAILED' para retry.
 */
export async function emitWebhookEvent(
  organizationId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    // Suscriptores activos para este evento (GIN index sobre events filtra).
    // .contains usa el operador @> de Postgres → eficiente con GIN.
    const { data: subs, error } = await supabaseAdmin
      .from("webhooks")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("activo", true)
      .is("deleted_at", null)
      .contains("events", [event])

    if (error) {
      console.error("[webhooks] error fetching subscribers:", error)
      return
    }
    if (!subs || subs.length === 0) return

    // Inserción batch de deliveries PENDING. Devolvemos ids para disparar.
    const rows = subs.map((s) => ({
      webhook_id: s.id,
      organization_id: organizationId,
      event,
      payload,
      status: "PENDING" as const,
    }))

    const { data: deliveries, error: insErr } = await supabaseAdmin
      .from("webhook_deliveries")
      .insert(rows)
      .select("id")

    if (insErr) {
      console.error("[webhooks] error inserting deliveries:", insErr)
      return
    }

    // Dispatch en paralelo sin esperar — el caller no se bloquea.
    // setTimeout(0) desacopla del request actual (Node lo dejará vivir).
    for (const d of deliveries || []) {
      setTimeout(() => {
        dispatch(d.id).catch((err) =>
          console.error("[webhooks] dispatch error:", d.id, err),
        )
      }, 0)
    }
  } catch (err) {
    // Nunca propagar — webhook es side-effect, no debe tirar el caller.
    console.error("[webhooks] emitWebhookEvent fatal:", err)
  }
}

/**
 * Ejecuta UN intento de entrega. Carga delivery + webhook, firma con HMAC,
 * POST con 5s timeout, persiste resultado.
 *
 * En éxito: webhooks.consecutive_failures = 0, last_success_at = NOW.
 * En fallo: incrementa consecutive_failures; auto-disable a los 10.
 *
 * Reutilizable desde el endpoint /retry y /test (con returnResult=true).
 */
export async function dispatch(
  deliveryId: string,
  options?: { returnResult?: boolean },
): Promise<{ ok: boolean; httpStatus: number | null; body: string | null }> {
  // Cargar delivery + webhook embebido en una query (FK join).
  const { data: delivery, error: fetchErr } = await supabaseAdmin
    .from("webhook_deliveries")
    .select("id, event, payload, attempts, webhook_id, webhooks(id, url, secret, headers, activo, deleted_at)")
    .eq("id", deliveryId)
    .single()

  if (fetchErr || !delivery) {
    console.error("[webhooks] delivery not found:", deliveryId, fetchErr)
    return { ok: false, httpStatus: null, body: null }
  }

  const wh = (delivery as any).webhooks as {
    id: string
    url: string
    secret: string
    headers: Record<string, string> | null
    activo: boolean
    deleted_at: string | null
  } | null

  if (!wh || !wh.activo || wh.deleted_at) {
    // Webhook fue desactivado/borrado entre emit y dispatch: marca como FAILED final.
    await supabaseAdmin
      .from("webhook_deliveries")
      .update({
        status: "FAILED",
        attempts: delivery.attempts + 1,
        last_attempt_at: new Date().toISOString(),
        response_body: "Webhook desactivado o eliminado",
      })
      .eq("id", deliveryId)
    return { ok: false, httpStatus: null, body: "Webhook desactivado" }
  }

  // Body canónico: stringify una sola vez. La firma se calcula sobre ESTE
  // string exacto (sin espacios, sin reordenar keys) — el cliente debe usar
  // el raw body para verificar.
  const body = JSON.stringify({
    event: delivery.event,
    payload: delivery.payload,
    deliveryId: delivery.id,
    timestamp: new Date().toISOString(),
  })

  const signature = createHmac("sha256", wh.secret).update(body).digest("hex")

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "stapp-webhooks/1.0",
    "X-Webhook-Event": delivery.event,
    "X-Webhook-Delivery": delivery.id,
    "X-Webhook-Signature": `sha256=${signature}`,
    // Custom headers del usuario (Authorization, etc). Custom override defaults
    // si choca, pero los X-Webhook-* arriba ya están seteados — el dispatcher
    // los mantiene como source of truth.
    ...(wh.headers || {}),
    "X-Webhook-Signature-Algo": "HMAC-SHA256",
  }

  let httpStatus: number | null = null
  let respBody: string | null = null
  let ok = false

  try {
    const res = await fetch(wh.url, {
      method: "POST",
      headers,
      body,
      // 5s timeout: balance entre tolerancia a endpoints lentos vs no colgar
      // el dispatcher. AbortSignal.timeout es builtin Node 18+.
      signal: AbortSignal.timeout(5000),
    })
    httpStatus = res.status
    // 2xx = éxito; cualquier otro = fallo.
    ok = res.status >= 200 && res.status < 300
    // Truncar body a 2KB — protege contra responses gigantes.
    const text = await res.text().catch(() => "")
    respBody = text.length > 2048 ? text.slice(0, 2048) + "…" : text
  } catch (err) {
    // Timeout, DNS, TLS, etc. httpStatus queda null para distinguir de 5xx.
    respBody = err instanceof Error ? err.message.slice(0, 2048) : String(err).slice(0, 2048)
    ok = false
  }

  const now = new Date().toISOString()
  const nextAttempts = delivery.attempts + 1

  // Backoff exponencial: 1min, 5min, 30min, 2h, 8h. Pasado el 5to intento no
  // re-agenda; queda FAILED y el usuario puede retry manual.
  const backoffMin = [1, 5, 30, 120, 480]
  const nextRetryAt = !ok && nextAttempts <= backoffMin.length
    ? new Date(Date.now() + backoffMin[nextAttempts - 1] * 60_000).toISOString()
    : null

  await supabaseAdmin
    .from("webhook_deliveries")
    .update({
      status: ok ? "SUCCESS" : "FAILED",
      http_status: httpStatus,
      response_body: respBody,
      attempts: nextAttempts,
      last_attempt_at: now,
      next_retry_at: nextRetryAt,
    })
    .eq("id", deliveryId)

  // Update agregado en webhooks. Lectura previa para incrementar atómico
  // no es necesaria — RPC seria mejor pero evitamos extra deps. Race con
  // dispatchs concurrentes puede subestimar consecutive_failures por uno,
  // aceptable (auto-disable es threshold-based, no exact).
  if (ok) {
    await supabaseAdmin
      .from("webhooks")
      .update({
        last_success_at: now,
        consecutive_failures: 0,
      })
      .eq("id", wh.id)
  } else {
    const { data: whRow } = await supabaseAdmin
      .from("webhooks")
      .select("consecutive_failures")
      .eq("id", wh.id)
      .single()
    const newFails = (whRow?.consecutive_failures ?? 0) + 1
    const updates: Record<string, unknown> = {
      last_failure_at: now,
      consecutive_failures: newFails,
    }
    // Anti-zombie: tras 10 fallos seguidos desactivar. El usuario debe
    // reactivar manualmente desde la UI (señal de que vio el problema).
    if (newFails >= 10) {
      updates.activo = false
    }
    await supabaseAdmin.from("webhooks").update(updates).eq("id", wh.id)
  }

  return { ok, httpStatus, body: respBody }
}
