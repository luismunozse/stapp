"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  DIE_CUT_SIZES,
  THERMAL_SIZES,
  type LabelSizeKey,
  type PrintMedium,
} from "@/lib/labels/build-labels-html"
import { isPrintMedium } from "@/lib/labels/etiqueta-inventario"
import { fetchOrgEtiquetaInventario, saveOrgEtiquetaInventario } from "@/lib/labels/etiqueta-inventario-org"
import { DEFAULT_MEDIUM, DEFAULT_SIZE, readLabelPrefs, type LabelPrefs } from "@/lib/labels/label-prefs"
import { fetchOrgEtiquetaSize } from "@/components/ordenes/etiqueta-size-org"

interface Options {
  /** El guardado en la org falló: el valor queda solo en este equipo. */
  onSaveFailed?: () => void
}

/**
 * Medio y tamaños de las etiquetas de inventario del taller.
 *
 * Orden de resolución al montar: org (inventario) -> localStorage del equipo ->
 * tamaño de la etiqueta de órdenes del taller (en térmica) -> térmica 50x30.
 * Se guardan los dos tamaños (rollo y hoja); la org recibe solo el par activo.
 *
 * Los handlers ignoran el eco de Radix Select: al setear un <Select> montado y
 * cerrado desde código (la respuesta de la org), Radix reemite
 * onValueChange(""), que NO es una elección del operador.
 */
export function useEtiquetaInventario({ onSaveFailed }: Options = {}) {
  const [medium, setMedium] = useState<PrintMedium>(DEFAULT_MEDIUM)
  const [thermalSize, setThermalSize] = useState<LabelSizeKey>(DEFAULT_SIZE)
  const [sheetSize, setSheetSize] = useState<LabelSizeKey>(DEFAULT_SIZE)
  // false hasta que terminó de resolverse (org / localStorage / órdenes).
  const [ready, setReady] = useState(false)
  // Si el operador ya eligió, una respuesta tardía de la org no debe pisarlo.
  const tocado = useRef(false)
  // El aviso de "queda solo en este equipo" sale una vez por diálogo abierto.
  const avisado = useRef(false)
  const onSaveFailedRef = useRef(onSaveFailed)
  useEffect(() => {
    onSaveFailedRef.current = onSaveFailed
  })

  useEffect(() => {
    let vivo = true
    const aplicar = (p: LabelPrefs) => {
      setMedium(p.medium)
      setThermalSize(p.thermalSize)
      setSheetSize(p.sheetSize)
    }

    const local = readLabelPrefs()
    if (local) aplicar(local)

    void (async () => {
      // En paralelo: el peor caso es un solo timeout (~3s), no dos en serie.
      const [org, orden] = await Promise.all([fetchOrgEtiquetaInventario(), fetchOrgEtiquetaSize()])
      if (!vivo) return
      if (!tocado.current) {
        if (org) {
          const base = local ?? { medium: DEFAULT_MEDIUM, thermalSize: DEFAULT_SIZE, sheetSize: DEFAULT_SIZE }
          aplicar({
            medium: org.medio,
            thermalSize: org.medio === "thermal" ? org.tamano : base.thermalSize,
            sheetSize: org.medio === "sheet" ? org.tamano : base.sheetSize,
          })
        } else if (!local && orden) {
          // Sin configuración propia: arranca con el tamaño que el taller ya usa
          // para las etiquetas de órdenes (todo tamaño de orden existe en térmica).
          setMedium("thermal")
          setThermalSize(orden)
        }
      }
      setReady(true)
    })()

    return () => {
      vivo = false
    }
  }, [])

  const guardar = useCallback((next: LabelPrefs) => {
    tocado.current = true
    setMedium(next.medium)
    setThermalSize(next.thermalSize)
    setSheetSize(next.sheetSize)
    setReady(true)
    void saveOrgEtiquetaInventario(next).then((enLaOrg) => {
      if (enLaOrg || avisado.current) return
      avisado.current = true
      onSaveFailedRef.current?.()
    })
  }, [])

  // Un "" nunca es una elección real: es el eco de Radix (ver lib/radix-select-echo.ts).
  const onMediumChange = useCallback(
    (v: string) => {
      if (!v || !isPrintMedium(v)) return
      guardar({ medium: v, thermalSize, sheetSize })
    },
    [guardar, thermalSize, sheetSize],
  )

  const onSizeChange = useCallback(
    (v: string) => {
      const valida = (medium === "thermal" ? THERMAL_SIZES : DIE_CUT_SIZES) as string[]
      if (!v || !valida.includes(v)) return
      const size = v as LabelSizeKey
      guardar(
        medium === "thermal"
          ? { medium, thermalSize: size, sheetSize }
          : { medium, thermalSize, sheetSize: size },
      )
    },
    [guardar, medium, thermalSize, sheetSize],
  )

  const size: LabelSizeKey = medium === "thermal" ? thermalSize : sheetSize

  return { medium, thermalSize, sheetSize, size, ready, onMediumChange, onSizeChange }
}
