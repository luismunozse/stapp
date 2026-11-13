"use client"

import { useCurrency } from "@/contexts/currency-context"
import { useMoneda } from "@/hooks/use-moneda"
import { etiquetaFuente, precioALocal, type MonedaCatalogo } from "@/lib/currency/catalogo"

interface EquivalenteLocalProps {
  monto: number | null
  moneda: MonedaCatalogo
}

/** Línea chica con el equivalente en moneda local de un precio en divisa. */
export function EquivalenteLocal({ monto, moneda }: EquivalenteLocalProps) {
  const { formatPrice } = useCurrency()
  const { config, tipoCambio } = useMoneda()
  if (moneda === null || !config) return null

  const equivalente = precioALocal(monto, moneda, config, tipoCambio ?? null)
  let texto: string
  if (equivalente === null || !tipoCambio?.disponible) {
    texto = `Sin cotización para ${moneda}`
  } else {
    const tc = tipoCambio.valor.toLocaleString("es-AR", { maximumFractionDigits: 6 })
    const fuente = etiquetaFuente(tipoCambio.fuente)
    if (tipoCambio.estado === "vivo") {
      texto = `≈ ${formatPrice(equivalente)} hoy (${fuente}, ${tc})`
    } else {
      const horas = Math.max(1, Math.floor((Date.now() - new Date(tipoCambio.en).getTime()) / 3_600_000))
      texto = `≈ ${formatPrice(equivalente)} (${fuente}, ${tc}, de hace ${horas} h)`
    }
  }
  return <p className="text-xs text-muted-foreground">{texto}</p>
}
