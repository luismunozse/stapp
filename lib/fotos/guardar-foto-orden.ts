import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { uploadOrderPhoto, deleteFile, base64ToBuffer } from "@/lib/storage"
import { enforcePlanLimit, isPlanLimitError, planLimitErrorResponse } from "@/lib/plan-limits"
import { updateStorageUsage } from "@/lib/subscriptions"

const MAX_BYTES = 5 * 1024 * 1024

export interface FotoAGuardar {
  organizationId: string
  ordenId: string
  /** Base64 sin el prefijo data:...;base64, */
  data: string
  mime: string
  tipo: string
  descripcion?: string | null
}

export type FotoGuardada =
  | { foto: Record<string, unknown> }
  /** Rechazo esperable (límite del plan, tamaño): se devuelve tal cual. */
  | { error: NextResponse }

/**
 * Sube una foto de orden a Storage, la registra en fotos_orden y actualiza el
 * uso de storage. Lo comparten la subida autenticada y la del enlace temporal
 * del celular: quien llama ya resolvió QUIÉN puede subir a esa orden.
 * Los errores inesperados se lanzan (van al catch de la ruta).
 */
export async function guardarFotoOrden(input: FotoAGuardar): Promise<FotoGuardada> {
  const { organizationId, ordenId, data, mime, tipo, descripcion } = input

  // Verificar límite de storage antes de subir
  const storageLimitError = await enforcePlanLimit(organizationId, "storage")
  if (storageLimitError) return { error: storageLimitError }

  // Validar tamaño de imagen (máx 5MB en base64)
  if (data.length * 0.75 > MAX_BYTES) {
    return {
      error: NextResponse.json(
        { error: "La imagen excede el tamaño máximo de 5MB" },
        { status: 400 }
      ),
    }
  }

  // Subir a Supabase Storage
  const buffer = base64ToBuffer(data)
  const { url, path } = await uploadOrderPhoto(organizationId, ordenId, buffer, mime)

  // Guardar referencia en la base de datos
  const { data: foto, error: dbError } = await supabaseAdmin
    .from("fotos_orden")
    .insert({
      orden_id: ordenId,
      url,
      storage_path: path,
      mime,
      size: buffer.length,
      descripcion: descripcion || null,
      tipo,
    })
    .select("id, url, storage_path, mime, size, descripcion, tipo, created_at")
    .single()

  if (dbError) {
    // Si falla el insert, eliminar el archivo subido
    await deleteFile("FOTOS_ORDENES", path)
    throw dbError
  }

  // Actualizar uso de storage. La RPC raisea si se excede el limite del
  // plan (race condition que el pre-check TS no atrapa). En ese caso,
  // rollbackear: borrar el archivo subido y el row recien insertado.
  const { error: storageRpcError } = await updateStorageUsage(organizationId, buffer.length)
  if (storageRpcError) {
    if (isPlanLimitError(storageRpcError)) {
      await deleteFile("FOTOS_ORDENES", path)
      await supabaseAdmin.from("fotos_orden").delete().eq("id", foto.id)
      return { error: planLimitErrorResponse(storageRpcError) }
    }
    console.error("Error updating storage usage:", storageRpcError)
  }

  return { foto }
}
