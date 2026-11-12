"use client"

import useSWR from "swr"
import type { ConfigMoneda } from "@/lib/currency/config-moneda"
import type { ResultadoTipoCambio } from "@/lib/currency/tipo-cambio"

const CONFIG_URL = "/api/configuracion/moneda"
const TIPO_CAMBIO_URL = "/api/moneda/tipo-cambio"

export interface ItemsEnDivisa {
  inventario: number
  servicios: number
}

interface RespuestaConfig {
  config: ConfigMoneda
  /** Solo lo devuelve la ruta a un ADMIN. */
  itemsEnDivisa: ItemsEnDivisa | null
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-cache" })
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return (await res.json()) as T
}

/**
 * Configuración multimoneda de la organización y su cotización vigente.
 * La cotización solo se pide cuando la función está habilitada.
 */
export function useMoneda() {
  const configSwr = useSWR<RespuestaConfig>(CONFIG_URL, getJson, { revalidateOnFocus: false })
  const habilitada = configSwr.data?.config?.habilitada === true
  const tipoCambioSwr = useSWR<ResultadoTipoCambio>(habilitada ? TIPO_CAMBIO_URL : null, getJson, {
    revalidateOnFocus: false,
  })

  const mutate = async (): Promise<void> => {
    await Promise.all([configSwr.mutate(), tipoCambioSwr.mutate()])
  }

  return {
    // Una respuesta sin `config` (error de la ruta, forma inesperada) se trata como sin datos.
    config: configSwr.data?.config as ConfigMoneda | undefined,
    tipoCambio: tipoCambioSwr.data as ResultadoTipoCambio | undefined,
    itemsEnDivisa: configSwr.data?.itemsEnDivisa ?? null,
    isLoading: configSwr.isLoading,
    error: configSwr.error as Error | undefined,
    mutate,
  }
}
