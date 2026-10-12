import { DEFAULT_LABEL_SIZE, isLabelSize, type LabelSize } from "@/lib/etiqueta-tamano"

// Cliente del tamaño de etiqueta POR TALLER (organizations.etiqueta_tamano).
// Orden de resolución: valor de la org -> localStorage legado -> default.
// La clave de localStorage es la misma que usaba print-label antes de que el
// tamaño pasara a la org, así que las PCs ya configuradas siguen andando.

const ENDPOINT = "/api/configuracion/etiqueta"
const STORAGE_KEY = "stapp:etiqueta-size"

// `local` = el PATCH falló: el tamaño vale solo en este equipo y no vence (si
// venciera, volvería el valor viejo de la org y el aviso "queda en este equipo"
// dejaría de ser cierto).
let cache: { value: LabelSize | null; at: number; local: boolean } | null = null
let inflight: Promise<LabelSize | null | undefined> | null = null
// Cada guardado sube la versión: un GET que arrancó antes no puede pisarlo.
let version = 0

// Un fetch colgado no puede frenar la impresión.
const FETCH_TIMEOUT_MS = 3000
// Sin recarga completa (sesión vencida -> login por router.push, cambio de
// org/impersonación) el módulo sobrevive: el TTL acota un valor ajeno.
const CACHE_TTL_MS = 60_000

/** Solo para tests. */
export function resetEtiquetaSizeCache(): void {
  cache = null
  inflight = null
  version++
}

function cacheVigente(): boolean {
  return !!cache && (cache.local || Date.now() - cache.at < CACHE_TTL_MS)
}

export function readLocalEtiquetaSize(): LabelSize | null {
  if (typeof window === "undefined") return null
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    return isLabelSize(v) ? v : null
  } catch {
    return null
  }
}

function writeLocalEtiquetaSize(size: LabelSize): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, size)
  } catch {
    /* localStorage no disponible (modo privado, etc.) */
  }
}

/**
 * Pide el valor de la org. Devuelve null si la org no lo configuró y undefined
 * si la consulta falló (no se cachea: se reintenta en la próxima impresión).
 */
export async function fetchOrgEtiquetaSize(): Promise<LabelSize | null | undefined> {
  if (cacheVigente()) return cache!.value
  if (typeof fetch === "undefined") return undefined
  if (!inflight) {
    const v = version
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => {
        controller?.abort()
        resolve(undefined)
      }, FETCH_TIMEOUT_MS)
    })
    const pedido = (async () => {
      try {
        const res = await fetch(ENDPOINT, { cache: "no-store", signal: controller?.signal })
        if (!res.ok) return undefined
        const json = (await res.json()) as { tamano?: unknown }
        const value = isLabelSize(json?.tamano) ? json.tamano : null
        // Un guardado posterior al inicio de este GET gana: su valor es más nuevo.
        if (v !== version) return cacheVigente() ? cache!.value : undefined
        cache = { value, at: Date.now(), local: false }
        return value
      } catch {
        return undefined
      }
    })()
    const p: Promise<LabelSize | null | undefined> = Promise.race([pedido, timeout]).finally(() => {
      clearTimeout(timer)
      if (inflight === p) inflight = null
    })
    inflight = p
  }
  return inflight
}

/** Tamaño efectivo para imprimir: org, luego localStorage, luego default. */
export async function resolveEtiquetaSize(): Promise<LabelSize> {
  const org = await fetchOrgEtiquetaSize()
  return org ?? readLocalEtiquetaSize() ?? DEFAULT_LABEL_SIZE
}

/**
 * Guarda el tamaño en la org y en localStorage (fallback si la org no lo
 * acepta). Devuelve true si quedó guardado en la org.
 */
export async function saveOrgEtiquetaSize(size: LabelSize): Promise<boolean> {
  writeLocalEtiquetaSize(size)
  version++
  inflight = null
  // Desde ya todos los callers de este equipo usan el tamaño elegido; si el
  // PATCH falla queda como valor local (no se vuelve a la org vieja).
  cache = { value: size, at: Date.now(), local: true }
  try {
    const res = await fetch(ENDPOINT, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tamano: size }),
    })
    if (!res.ok) return false
    if (cache?.value === size) cache = { value: size, at: Date.now(), local: false }
    return true
  } catch {
    return false
  }
}
