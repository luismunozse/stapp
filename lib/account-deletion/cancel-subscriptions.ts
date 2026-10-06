import { supabaseAdmin } from "@/lib/supabase"
import { cancelPreApproval } from "@/lib/mercadopago"
import { cancelRebillSubscription } from "@/lib/rebill"
import { cancelCreemSubscription } from "@/lib/creem"

export type CancelResult =
  | { ok: true; canceled: string[]; skipped: boolean }
  | { ok: false; failed: string[]; canceled: string[] }

/**
 * Un reintento después de un fallo parcial vuelve a llamar al proveedor que ya
 * canceló. Ese rechazo no es un error real. Heurística sobre el mensaje: el
 * texto exacto de MercadoPago/Rebill se confirma en la prueba manual con un
 * taller de prueba; si no matchea, el resultado es un 502 reintentable.
 */
/**
 * El SDK de MercadoPago rechaza con el cuerpo JSON parseado (objeto plano, no
 * Error), así que el texto se arma desde message/error/cause (y sus message
 * anidados) con JSON.stringify como último recurso.
 */
function errorText(err: unknown): string {
  if (typeof err === "string") return err
  if (err instanceof Error) {
    return [err.message, err.cause ? errorText(err.cause) : ""].join(" ")
  }
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>
    const parts = [o.message, o.error, o.cause]
      .filter((v) => v !== undefined && v !== null)
      .map((v) => (typeof v === "object" ? errorText(v) : String(v)))
    if (parts.length > 0) return parts.join(" ")
    try {
      return JSON.stringify(err)
    } catch {
      return ""
    }
  }
  return String(err)
}

export function isAlreadyCanceledError(err: unknown): boolean {
  const msg = errorText(err)
  return /(already|ya)\s+(is\s+|est[aá]\s+)?cancel/i.test(msg) || /cannot (modify|update).*cancel/i.test(msg)
}

/**
 * Cancela la suscripción de la organización en cada proveedor con id. Aísla
 * fallos (un id viejo de otro proveedor no frena al que cobra) y es idempotente
 * por el lado del proveedor ("ya cancelada" cuenta como éxito). NO usa
 * `subscriptions.canceled_at` para saltearse proveedores: el webhook de Rebill
 * reactiva sin limpiarlo, y saltearlo podría seguir cobrando a una org eliminada.
 */
export async function cancelOrganizationSubscriptions(organizationId: string): Promise<CancelResult> {
  const { data: sub, error } = await supabaseAdmin
    .from("subscriptions")
    .select("mercadopago_preapproval_id, rebill_subscription_id, creem_subscription_id")
    .eq("organization_id", organizationId)
    .maybeSingle()

  if (error) return { ok: false, failed: ["DB"], canceled: [] }
  if (!sub) return { ok: true, canceled: [], skipped: true }

  const jobs: Array<[string, () => Promise<unknown>]> = []
  if (sub.mercadopago_preapproval_id) jobs.push(["MERCADOPAGO", () => cancelPreApproval(sub.mercadopago_preapproval_id)])
  if (sub.rebill_subscription_id) jobs.push(["REBILL", () => cancelRebillSubscription(sub.rebill_subscription_id)])
  if (sub.creem_subscription_id) jobs.push(["CREEM", () => cancelCreemSubscription(sub.creem_subscription_id)])

  const canceled: string[] = []
  const failed: string[] = []
  for (const [proveedor, cancelar] of jobs) {
    try {
      await cancelar()
      canceled.push(proveedor)
    } catch (err) {
      if (isAlreadyCanceledError(err)) {
        canceled.push(proveedor)
      } else {
        console.error(`[account-deletion] error cancelando en ${proveedor}:`, err)
        failed.push(proveedor)
      }
    }
  }

  return failed.length > 0 ? { ok: false, failed, canceled } : { ok: true, canceled, skipped: false }
}
