import { supabaseAdmin } from "@/lib/supabase"
import { cancelOrganizationSubscriptions } from "./cancel-subscriptions"
import { removePrefix, storageTargets } from "./storage"

export type PurgeStep = "precheck" | "subscriptions" | "storage" | "database"

export interface PurgeOptions {
  /** Timestamp (ms) a partir del cual no se empiezan más borrados de storage. */
  deadline?: number
  /**
   * Solo purgar si la org sigue archivada POR PEDIDO del usuario. Lo pasa el
   * cron: entre que selecciona el candidato y lo purga, el superadmin pudo
   * restaurarlo. La purga manual del superadmin no lo usa.
   */
  expectArchived?: boolean
}

export type PurgeResult =
  | { ok: true; removedFiles: number; skipped?: "not-found" | "not-archived" }
  | { ok: false; step: PurgeStep; error: string }

const fail = (step: PurgeStep, error: string): PurgeResult => ({ ok: false, step, error })

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/**
 * Borrado definitivo de una organización: cancela la suscripción en cada
 * proveedor, vacía storage (recursivo, todos los buckets) y borra la fila
 * (el resto cae en cascada). Cada paso es idempotente; ante un fallo corta y
 * devuelve el paso, y el caller (cron) reintenta en la próxima corrida.
 *
 * Storage intenta TODOS los destinos aunque alguno falle, pero si alguno falló
 * no se borra la fila: sin la fila el próximo intento no podría reencontrar
 * los archivos huérfanos.
 */
export async function purgeOrganization(orgId: string, opts: PurgeOptions = {}): Promise<PurgeResult> {
  if (typeof orgId !== "string" || !orgId.trim()) {
    return fail("precheck", "organizationId vacío")
  }

  if (opts.expectArchived) {
    const { data: org, error } = await supabaseAdmin
      .from("organizations")
      .select("id, deleted_at, deletion_requested_at")
      .eq("id", orgId)
      .maybeSingle()
    if (error) return fail("precheck", error.message)
    if (!org) return { ok: true, removedFiles: 0, skipped: "not-found" }
    if (!org.deleted_at || !org.deletion_requested_at) return { ok: true, removedFiles: 0, skipped: "not-archived" }
  }

  const cancel = await cancelOrganizationSubscriptions(orgId)
  if (!cancel.ok) return fail("subscriptions", `no se pudo cancelar en: ${cancel.failed.join(", ")}`)

  let removedFiles = 0
  const failures: string[] = []
  try {
    for (const { bucket, prefix } of await storageTargets(orgId)) {
      try {
        removedFiles += await removePrefix(bucket, prefix, opts.deadline)
      } catch (err) {
        failures.push(`${bucket}/${prefix}: ${errText(err)}`)
      }
    }
  } catch (err) {
    return fail("storage", errText(err))
  }
  if (failures.length > 0) return fail("storage", failures.join("; "))

  let del = supabaseAdmin.from("organizations").delete().eq("id", orgId)
  if (opts.expectArchived) del = del.not("deleted_at", "is", null)
  const { error: deleteError } = await del
  if (deleteError) return fail("database", deleteError.message)

  return { ok: true, removedFiles }
}
