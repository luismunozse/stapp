import { supabaseAdmin, STORAGE_BUCKETS } from "./supabase"
import { v4 as uuidv4 } from "uuid"

interface UploadResult {
  url: string
  path: string
}

/**
 * Subir foto de una orden
 * Path: fotos-ordenes/{orgId}/{ordenId}/{uuid}.{ext}
 */
export async function uploadOrderPhoto(
  orgId: string,
  ordenId: string,
  file: Buffer | Blob,
  mime: string,
  originalName?: string
): Promise<UploadResult> {
  const ext = getExtensionFromMime(mime)
  const fileName = `${uuidv4()}.${ext}`
  const path = `${orgId}/${ordenId}/${fileName}`

  const { error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKETS.FOTOS_ORDENES)
    .upload(path, file, {
      contentType: mime,
      upsert: false,
    })

  if (error) {
    throw new Error(`Error uploading photo: ${error.message}`)
  }

  const { data: urlData } = supabaseAdmin.storage
    .from(STORAGE_BUCKETS.FOTOS_ORDENES)
    .getPublicUrl(path)

  return {
    url: urlData.publicUrl,
    path,
  }
}

/**
 * Subir logo de organización
 * Path: logos/{orgId}/logo.{ext}
 */
export async function uploadLogo(
  orgId: string,
  file: Buffer | Blob,
  mime: string
): Promise<UploadResult> {
  const ext = getExtensionFromMime(mime)
  const path = `${orgId}/logo.${ext}`

  // Intentar eliminar el logo anterior si existe
  await supabaseAdmin.storage
    .from(STORAGE_BUCKETS.LOGOS)
    .remove([path])
    .catch(() => {}) // Ignorar errores si no existe

  const { error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKETS.LOGOS)
    .upload(path, file, {
      contentType: mime,
      upsert: true,
    })

  if (error) {
    throw new Error(`Error uploading logo: ${error.message}`)
  }

  const { data: urlData } = supabaseAdmin.storage
    .from(STORAGE_BUCKETS.LOGOS)
    .getPublicUrl(path)

  return {
    url: urlData.publicUrl,
    path,
  }
}

/**
 * Subir firma digital
 * Path: firmas/{orgId}/{entityType}/{entityId}/{uuid}.png
 */
export async function uploadSignature(
  orgId: string,
  entityType: "cotizacion" | "checklist",
  entityId: string,
  file: Buffer | Blob
): Promise<UploadResult> {
  const fileName = `${uuidv4()}.png`
  const path = `${orgId}/${entityType}/${entityId}/${fileName}`

  const { error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKETS.FIRMAS)
    .upload(path, file, {
      contentType: "image/png",
      upsert: false,
    })

  if (error) {
    throw new Error(`Error uploading signature: ${error.message}`)
  }

  const { data: urlData } = supabaseAdmin.storage
    .from(STORAGE_BUCKETS.FIRMAS)
    .getPublicUrl(path)

  return {
    url: urlData.publicUrl,
    path,
  }
}

/**
 * Subir archivo de importación (CSV/Excel)
 * Path: csv-imports/{orgId}/{uuid}.{ext}
 */
export async function uploadImportFile(
  orgId: string,
  file: Buffer | Blob,
  mime: string,
  originalName: string
): Promise<UploadResult> {
  const ext = mime.includes('csv') ? 'csv' : 'xlsx'
  const fileName = `${uuidv4()}.${ext}`
  const path = `${orgId}/${fileName}`

  const { error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKETS.CSV_IMPORTS)
    .upload(path, file, {
      contentType: mime,
      upsert: false,
    })

  if (error) {
    throw new Error(`Error uploading import file: ${error.message}`)
  }

  const { data: urlData } = supabaseAdmin.storage
    .from(STORAGE_BUCKETS.CSV_IMPORTS)
    .getPublicUrl(path)

  return {
    url: urlData.publicUrl,
    path,
  }
}

/**
 * Eliminar archivo de storage
 */
export async function deleteFile(
  bucket: keyof typeof STORAGE_BUCKETS,
  path: string
): Promise<void> {
  const { error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKETS[bucket])
    .remove([path])

  if (error) {
    console.error(`Error deleting file from ${bucket}:`, error)
    // No lanzar error, solo log (el archivo puede no existir)
  }
}

/**
 * Eliminar todas las fotos de una orden
 */
export async function deleteOrderPhotos(
  orgId: string,
  ordenId: string
): Promise<void> {
  const folderPath = `${orgId}/${ordenId}`

  // Listar archivos en la carpeta
  const { data: files } = await supabaseAdmin.storage
    .from(STORAGE_BUCKETS.FOTOS_ORDENES)
    .list(folderPath)

  if (files && files.length > 0) {
    const paths = files.map(f => `${folderPath}/${f.name}`)
    await supabaseAdmin.storage
      .from(STORAGE_BUCKETS.FOTOS_ORDENES)
      .remove(paths)
  }
}

/**
 * Eliminar logo de organización
 */
export async function deleteLogo(orgId: string): Promise<void> {
  const folderPath = orgId

  const { data: files } = await supabaseAdmin.storage
    .from(STORAGE_BUCKETS.LOGOS)
    .list(folderPath)

  if (files && files.length > 0) {
    const paths = files.map(f => `${folderPath}/${f.name}`)
    await supabaseAdmin.storage
      .from(STORAGE_BUCKETS.LOGOS)
      .remove(paths)
  }
}

/**
 * Obtener extensión de archivo desde MIME type
 */
function getExtensionFromMime(mime: string): string {
  const mimeToExt: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
  }
  return mimeToExt[mime] || "bin"
}

/**
 * Convertir base64 a Buffer (para migración de datos existentes)
 */
export function base64ToBuffer(base64: string): Buffer {
  return Buffer.from(base64, "base64")
}

/**
 * Convertir Data URL a Buffer y MIME
 */
export function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; mime: string } {
  const matches = dataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/)
  if (!matches || matches.length !== 3) {
    throw new Error("Invalid data URL")
  }
  return {
    mime: matches[1],
    buffer: Buffer.from(matches[2], "base64"),
  }
}
