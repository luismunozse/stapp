"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { DEFAULT_LABEL_SIZE, type LabelSize } from "@/lib/etiqueta-tamano"
import { resolveEtiquetaSize, saveOrgEtiquetaSize } from "./etiqueta-size-org"

/**
 * Tamaño de etiqueta vigente del taller para mostrar en un selector.
 * `update` lo aplica al instante y lo guarda en la org; devuelve false si la
 * org no pudo guardarlo (queda solo en este navegador).
 */
export function useEtiquetaSize() {
  const [size, setSize] = useState<LabelSize>(DEFAULT_LABEL_SIZE)
  // Si el usuario ya eligió, una respuesta tardía de la org no debe pisarlo.
  const tocado = useRef(false)
  // false hasta que la org respondió (o el usuario eligió): mientras tanto
  // `size` es solo el default y los callers deben dejar que printDeviceLabel
  // lo resuelva solo.
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let vivo = true
    resolveEtiquetaSize().then((s) => {
      if (!vivo) return
      if (!tocado.current) setSize(s)
      setReady(true)
    })
    return () => {
      vivo = false
    }
  }, [])

  const update = useCallback(async (next: LabelSize) => {
    tocado.current = true
    setSize(next)
    setReady(true)
    return saveOrgEtiquetaSize(next)
  }, [])

  return { size, ready, update }
}
