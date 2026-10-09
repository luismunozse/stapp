"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
import { ignoreSelectEcho } from "@/lib/radix-select-echo"

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
 * Los handlers están protegidos contra el eco de Radix Select: al setear un
 * <Select> montado y cerrado desde código (la respuesta de la org), Radix
 * reemite onValueChange(""), que NO es una elección del operador.
 */
export function useEtiquetaInventario({ onSaveFailed }: Options = {}) {
  const [medium, setMedium] = useState<PrintMedium>(DEFAULT_MEDIUM)
  const [thermalSize, setThermalSize] = useState<LabelSizeKey>(DEFAULT_SIZE)
  const [sheetSize, setSheetSize] = useState<LabelSizeKey>(DEFAULT_SIZE)
  // false hasta que terminó de resolverse (org / localStorage / órdenes).
  const [ready, setReady] = useState(false)
  // Si el operador ya eligió, una respuesta tardía de la org no debe pisarlo.
  const tocado = useRef(false)
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
      const org = await fetchOrgEtiquetaInventario()
      if (!vivo) return
      if (org) {
        if (!tocado.current) {
          const base = local ?? { medium: DEFAULT_MEDIUM, thermalSize: DEFAULT_SIZE, sheetSize: DEFAULT_SIZE }
          aplicar({
            medium: org.medio,
            thermalSize: org.medio === "thermal" ? org.tamano : base.thermalSize,
            sheetSize: org.medio === "sheet" ? org.tamano : base.sheetSize,
          })
        }
      } else if (!local) {
        // Sin configuración propia: arranca con el tamaño que el taller ya usa
        // para las etiquetas de órdenes (todo tamaño de orden existe en térmica).
        const orden = await fetchOrgEtiquetaSize()
        if (!vivo) return
        if (orden && !tocado.current) {
          setMedium("thermal")
          setThermalSize(orden)
        }
      }
      if (vivo) setReady(true)
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
      if (!enLaOrg) onSaveFailedRef.current?.()
    })
  }, [])

  const aplicarMedio = useCallback(
    (v: string) => {
      if (!isPrintMedium(v)) return
      guardar({ medium: v, thermalSize, sheetSize })
    },
    [guardar, thermalSize, sheetSize],
  )

  const aplicarTamano = useCallback(
    (v: string) => {
      const valida = (medium === "thermal" ? THERMAL_SIZES : DIE_CUT_SIZES) as string[]
      if (!valida.includes(v)) return
      const size = v as LabelSizeKey
      guardar(
        medium === "thermal"
          ? { medium, thermalSize: size, sheetSize }
          : { medium, thermalSize, sheetSize: size },
      )
    },
    [guardar, medium, thermalSize, sheetSize],
  )

  // Un "" nunca es una elección real (ver lib/radix-select-echo.ts).
  // Falso positivo de la regla: estos handlers solo corren en eventos del
  // <Select>, nunca durante el render; los refs se tocan recién ahí.
  /* eslint-disable react-hooks/refs */
  const onMediumChange = useMemo(() => ignoreSelectEcho(aplicarMedio), [aplicarMedio])
  const onSizeChange = useMemo(() => ignoreSelectEcho(aplicarTamano), [aplicarTamano])
  /* eslint-enable react-hooks/refs */

  const size: LabelSizeKey = medium === "thermal" ? thermalSize : sheetSize

  return { medium, thermalSize, sheetSize, size, ready, onMediumChange, onSizeChange }
}
