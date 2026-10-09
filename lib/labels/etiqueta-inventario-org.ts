import type { LabelSizeKey, PrintMedium } from "@/lib/labels/build-labels-html"
import { isValidMediumSize } from "@/lib/labels/etiqueta-inventario"
import { saveLabelPrefs, type LabelPrefs } from "@/lib/labels/label-prefs"

// Cliente del medio + tamaño de las etiquetas de INVENTARIO POR TALLER
// (organizations.etiqueta_inventario_medio / _tamano). Sin caché de módulo: el
// único consumidor es el diálogo de impresión, que lo pide al abrirse.

const ENDPOINT = "/api/configuracion/etiqueta-inventario"

// Un fetch colgado no puede dejar el diálogo esperando a la org.
const FETCH_TIMEOUT_MS = 3000

// Cola de guardados; `enviar` nunca rechaza, así que la cadena no se corta.
let cola: Promise<unknown> = Promise.resolve()

export interface EtiquetaInventarioOrg {
  medio: PrintMedium
  tamano: LabelSizeKey
}

/**
 * Pide el valor de la org. Devuelve null si la org no lo configuró y undefined
 * si la consulta falló (el llamador cae al localStorage).
 */
export async function fetchOrgEtiquetaInventario(): Promise<EtiquetaInventarioOrg | null | undefined> {
  if (typeof fetch === "undefined") return undefined
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
      const json = (await res.json()) as { medio?: unknown; tamano?: unknown }
      if (!isValidMediumSize(json?.medio, json?.tamano)) return null
      return { medio: json.medio, tamano: json.tamano as LabelSizeKey }
    } catch {
      return undefined
    }
  })()
  try {
    return await Promise.race([pedido, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Guarda el medio activo y su tamaño en la org, y las preferencias completas en
 * localStorage (fallback si la org no las acepta). Devuelve true solo si
 * quedaron guardadas en la org.
 */
export function saveOrgEtiquetaInventario(prefs: LabelPrefs): Promise<boolean> {
  saveLabelPrefs(prefs)
  const tamano = prefs.medium === "thermal" ? prefs.thermalSize : prefs.sheetSize
  const enviar = async (): Promise<boolean> => {
    try {
      const res = await fetch(ENDPOINT, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ medio: prefs.medium, tamano }),
      })
      return res.ok
    } catch {
      return false
    }
  }
  // Cada PATCH sale recién cuando el anterior terminó: dos cambios seguidos
  // (medio y después tamaño) no pueden llegar desordenados y dejar el par viejo.
  const p = cola.then(enviar)
  cola = p
  return p
}
