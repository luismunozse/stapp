"use client"

import { useCurrency } from "@/contexts/currency-context"
import { formatDivisa } from "@/lib/currency/formato-divisa"
import type { MonedaCatalogo } from "@/lib/currency/catalogo"

interface PrecioEnMonedaProps {
  monto: number | null
  moneda: MonedaCatalogo
}

/** Un monto en la moneda propia del ítem: local con la moneda de la organización, divisa con su código. */
export function PrecioEnMoneda({ monto, moneda }: PrecioEnMonedaProps) {
  const { formatPrice } = useCurrency()
  if (monto === null) return <>—</>
  return <>{moneda === null ? formatPrice(monto) : formatDivisa(monto, moneda)}</>
}
