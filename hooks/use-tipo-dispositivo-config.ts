"use client"

import { useMemo } from "react"
import { FALLBACK_CONFIG } from "@/lib/tipos-dispositivo-defaults"
import type { TipoDispositivoConfig, CampoExtra } from "@/types"

interface TipoOption {
  codigo: string
  nombre: string
  config?: TipoDispositivoConfig | null
}

/**
 * Resuelve el config efectivo de un tipo de dispositivo y sus derivados.
 * Compartido por el alta de una orden y por la recepción múltiple, donde se
 * usa una vez por equipo.
 */
export function useTipoDispositivoConfig(tipos: TipoOption[], codigoSeleccionado: string) {
  return useMemo(() => {
    const tipoSeleccionado = tipos.find((t) => t.codigo === codigoSeleccionado)
    const config: TipoDispositivoConfig =
      tipoSeleccionado?.config && Object.keys(tipoSeleccionado.config).length > 0
        ? tipoSeleccionado.config
        : FALLBACK_CONFIG

    return {
      config,
      accesoriosDisponibles: config.accesorios || FALLBACK_CONFIG.accesorios!,
      problemasComunes: config.problemasComunes || FALLBACK_CONFIG.problemasComunes!,
      marcasDisponibles: config.marcas || [],
      camposExtra: (config.camposExtra || []) as CampoExtra[],
      showImei: config.campos?.imei?.visible !== false,
      showPassword: config.campos?.password?.visible !== false,
      showColor: config.campos?.color?.visible !== false,
      showMarca: config.campos?.marca?.visible !== false,
    }
  }, [tipos, codigoSeleccionado])
}
