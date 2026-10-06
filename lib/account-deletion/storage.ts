import crypto from "crypto"
import { supabaseAdmin, STORAGE_BUCKETS } from "@/lib/supabase"

// Este bucket no está en STORAGE_BUCKETS: lo usa app/api/proveedores/[id]/adjuntos.
export const PROVEEDOR_ADJUNTOS_BUCKET = "proveedor-adjuntos"

// Todos los buckets con archivos de una organización. Los APK son de la
// plataforma, no de ningún taller.
export const PURGE_BUCKETS: string[] = [
  ...Object.values(STORAGE_BUCKETS).filter((b) => b !== STORAGE_BUCKETS.APK_RELEASES),
  PROVEEDOR_ADJUNTOS_BUCKET,
]

/**
 * Prefijo con el que el upload PÚBLICO del catálogo guarda los archivos, para
 * no exponer el organization_id en la URL. Misma fórmula que
 * app/api/public/catalogo/[slug]/upload/route.ts (que ahora la importa de acá).
 * Si NEXTAUTH_SECRET rota, los archivos anteriores quedan bajo el hash viejo y
 * no se pueden recalcular: es una limitación aceptada.
 */
export function catalogoOrgHash(orgId: string): string {
  return crypto
    .createHash("sha256")
    .update(`${orgId}:${process.env.NEXTAUTH_SECRET || "stapp"}`)
    .digest("hex")
    .slice(0, 16)
}

const PAGE = 1000
const REMOVE_CHUNK = 100

function isMissingBucket(message: string): boolean {
  return /not found/i.test(message)
}

/**
 * Lista TODOS los archivos bajo `prefix`, recorriendo subcarpetas y paginando.
 * En storage de Supabase las carpetas vienen sin `id` (`id: null`) y `list` no
 * es recursivo: un barrido plano de `{orgId}/` se saltea `{orgId}/{ordenId}/…`.
 */
export async function listAllFiles(bucket: string, prefix: string): Promise<string[]> {
  const files: string[] = []
  const pending = [prefix]
  while (pending.length > 0) {
    const dir = pending.pop() as string
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await supabaseAdmin.storage.from(bucket).list(dir, { limit: PAGE, offset })
      if (error) throw new Error(`storage list (${bucket}/${dir}): ${error.message}`)
      const entries = data ?? []
      for (const entry of entries) {
        const full = `${dir}/${entry.name}`
        if (entry.id === null) pending.push(full)
        else files.push(full)
      }
      if (entries.length < PAGE) break
    }
  }
  return files
}

/** Borra todo lo que hay bajo `prefix`. Devuelve cuántos archivos borró. */
export async function removePrefix(bucket: string, prefix: string, deadline?: number): Promise<number> {
  let files: string[]
  try {
    files = await listAllFiles(bucket, prefix)
  } catch (err) {
    if (err instanceof Error && isMissingBucket(err.message)) return 0
    throw err
  }

  let removed = 0
  for (let i = 0; i < files.length; i += REMOVE_CHUNK) {
    if (deadline !== undefined && Date.now() > deadline) {
      throw new Error(`deadline excedido borrando ${bucket}/${prefix} (${removed}/${files.length})`)
    }
    const chunk = files.slice(i, i + REMOVE_CHUNK)
    const { error } = await supabaseAdmin.storage.from(bucket).remove(chunk)
    if (error) throw new Error(`storage remove (${bucket}): ${error.message}`)
    removed += chunk.length
  }
  return removed
}

/** Todos los (bucket, prefijo) donde una organización puede tener archivos. */
export async function storageTargets(orgId: string): Promise<Array<{ bucket: string; prefix: string }>> {
  const targets = PURGE_BUCKETS.map((bucket) => ({ bucket, prefix: orgId }))
  targets.push({ bucket: STORAGE_BUCKETS.LOGOS, prefix: `proveedores/${orgId}` })
  targets.push({ bucket: STORAGE_BUCKETS.CATALOGO, prefix: catalogoOrgHash(orgId) })

  // soporte-attachments se organiza por ticket ({ticketId}/{messageId}/…), no por org.
  // Los ids hay que leerlos ANTES de borrar la fila de la org (los tickets caen en cascada).
  const { data: tickets, error } = await supabaseAdmin
    .from("support_tickets")
    .select("id")
    .eq("organization_id", orgId)
  if (error) throw new Error(`support_tickets: ${error.message}`)
  for (const t of tickets ?? []) targets.push({ bucket: STORAGE_BUCKETS.SOPORTE_ATTACHMENTS, prefix: t.id })

  return targets
}
