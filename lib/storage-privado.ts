import { supabaseAdmin, STORAGE_BUCKETS } from "./supabase"

/**
 * Buckets privados: sus archivos no tienen URL pública y se sirven solo con
 * URLs firmadas que vencen. Las filas viejas guardan la URL pública con la que
 * se subió el archivo; las nuevas pueden guardar el path. Este módulo acepta
 * los dos formatos y siempre devuelve una URL firmada.
 */
export type BucketPrivado =
  | "FOTOS_ORDENES"
  | "FIRMAS"
  | "COMPROBANTES_GASTOS"
  | "SOPORTE_ATTACHMENTS"

/** Vigencia de las URLs firmadas que se entregan a la UI (1 hora). */
export const VIGENCIA_URL_FIRMADA_SEG = 60 * 60

/**
 * Devuelve el path del archivo dentro del bucket a partir de lo que guarda la
 * base: un path pelado, o una URL de Storage (pública o firmada) del mismo
 * bucket. Devuelve null si la referencia apunta a otro bucket, a otro host que
 * no sea Storage, o no es interpretable.
 */
export function pathDesdeReferencia(
  bucket: BucketPrivado,
  referencia: string | null | undefined
): string | null {
  if (typeof referencia !== "string") return null
  const valor = referencia.trim()
  if (!valor) return null

  const nombreBucket = STORAGE_BUCKETS[bucket]

  if (!/^[a-z][a-z0-9+.-]*:/i.test(valor)) {
    return pathSeguro(valor.replace(/^\/+/, ""))
  }

  let url: URL
  try {
    url = new URL(valor)
  } catch {
    return null
  }

  const prefijo = new RegExp(
    `^/storage/v1/object/(?:public|sign|authenticated)/${escaparRegex(nombreBucket)}/(.+)$`
  )
  const match = url.pathname.match(prefijo)
  if (!match) return null

  let path: string
  try {
    path = decodeURIComponent(match[1])
  } catch {
    return null
  }
  return pathSeguro(path)
}

function pathSeguro(path: string): string | null {
  if (!path) return null
  if (path.split("/").some((segmento) => segmento === ".." || segmento === ".")) return null
  return path
}

function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Firma varias referencias del mismo bucket en una sola llamada a Storage.
 * Devuelve un arreglo del mismo largo: la URL firmada, o null si la referencia
 * es inválida, no empieza con `prefijo` (cuando se pasa) o Storage no pudo
 * firmarla.
 */
export async function firmarReferencias(
  bucket: BucketPrivado,
  referencias: ReadonlyArray<string | null | undefined>,
  opciones: { prefijo?: string; vigenciaSeg?: number } = {}
): Promise<(string | null)[]> {
  const { prefijo, vigenciaSeg = VIGENCIA_URL_FIRMADA_SEG } = opciones

  const paths = referencias.map((ref) => {
    const path = pathDesdeReferencia(bucket, ref)
    if (!path) return null
    if (prefijo && !path.startsWith(prefijo.endsWith("/") ? prefijo : `${prefijo}/`)) return null
    return path
  })

  const unicos = Array.from(new Set(paths.filter((p): p is string => p !== null)))
  if (unicos.length === 0) return paths.map(() => null)

  const { data, error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKETS[bucket])
    .createSignedUrls(unicos, vigenciaSeg)

  if (error || !data) {
    console.error(`Error firmando URLs de ${STORAGE_BUCKETS[bucket]}:`, error)
    return paths.map(() => null)
  }

  const firmadas = new Map<string, string>()
  for (const item of data) {
    if (item.path && item.signedUrl && !item.error) firmadas.set(item.path, item.signedUrl)
  }

  return paths.map((p) => (p ? firmadas.get(p) ?? null : null))
}

/** Firma una sola referencia. Ver {@link firmarReferencias}. */
export async function firmarReferencia(
  bucket: BucketPrivado,
  referencia: string | null | undefined,
  opciones: { prefijo?: string; vigenciaSeg?: number } = {}
): Promise<string | null> {
  const [firmada] = await firmarReferencias(bucket, [referencia], opciones)
  return firmada
}

/**
 * Reemplaza `campo` de cada objeto por su URL firmada. Para el path usa
 * `campoPath` si viene con valor (p. ej. `storage_path`) y si no, el propio
 * `campo`. Los objetos que no se pueden firmar quedan con `campo` en null.
 */
export async function firmarCampo<T extends Record<string, unknown>>(
  bucket: BucketPrivado,
  filas: ReadonlyArray<T>,
  campo: keyof T & string,
  opciones: { campoPath?: keyof T & string; prefijo?: string } = {}
): Promise<T[]> {
  const { campoPath, prefijo } = opciones
  const referencias = filas.map((fila) => {
    const path = campoPath ? fila[campoPath] : undefined
    if (typeof path === "string" && path) return path
    const valor = fila[campo]
    return typeof valor === "string" ? valor : null
  })
  const firmadas = await firmarReferencias(bucket, referencias, { prefijo })
  return filas.map((fila, i) => ({ ...fila, [campo]: firmadas[i] }))
}
