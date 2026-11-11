"use client"

import { useCallback, useEffect, useState } from "react"
import { fetchReporte, type ResultadoReporte } from "@/lib/reportes/fetch-reporte"

export type EstadoReporte<T> = { estado: "cargando" } | ResultadoReporte<T>

/**
 * Carga un reporte con fetchReporte() y expone `reintentar` para el botón del
 * estado de error. Una respuesta vieja que llega tarde (por un reintento o un
 * desmontaje) se descarta.
 */
export function useReporte<T>(url: string) {
  const [resultado, setResultado] = useState<EstadoReporte<T>>({ estado: "cargando" })
  const [intento, setIntento] = useState(0)

  useEffect(() => {
    let vigente = true
    fetchReporte<T>(url).then((r) => {
      if (vigente) setResultado(r)
    })
    return () => {
      vigente = false
    }
  }, [url, intento])

  const reintentar = useCallback(() => {
    setResultado({ estado: "cargando" })
    setIntento((i) => i + 1)
  }, [])

  return { resultado, reintentar }
}
