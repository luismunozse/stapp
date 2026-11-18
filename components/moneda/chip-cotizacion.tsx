"use client"

import Link from "next/link"
import { AlertTriangle, ArrowLeftRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatCurrencyValue, type CurrencyCode } from "@/lib/currency"
import { antiguedad } from "@/lib/currency/antiguedad"
import { etiquetaFuente } from "@/lib/currency/catalogo"
import type { MonedaExtranjera } from "@/lib/currency/convert"
import type { ResultadoTipoCambio } from "@/lib/currency/tipo-cambio"

interface ChipCotizacionProps {
  tipoCambio: ResultadoTipoCambio | undefined
  monedaLocal: string
  /** Only used to name the currency when there is no rate (the result does not carry it then). */
  monedaExtranjera?: MonedaExtranjera
}

const BASE = "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium"

/** The exchange rate in use, e.g. "USD Blue · $ 1.200,00 · hace 5 min". */
export function ChipCotizacion({ tipoCambio, monedaLocal, monedaExtranjera }: ChipCotizacionProps) {
  if (!tipoCambio) return null
  if (!tipoCambio.disponible) {
    if (tipoCambio.motivo === "DESHABILITADA") return null
    return (
      <span role="status" className={cn(BASE, "border-warning/30 bg-warning-50 text-warning-700 dark:bg-warning/10 dark:text-warning-500")}>
        <AlertTriangle className="h-3 w-3 shrink-0" />
        <span>Sin cotización de {monedaExtranjera ?? "la divisa"}</span>
        <Link href="/configuracion?tab=moneda" className="underline underline-offset-2">
          Configurar
        </Link>
      </span>
    )
  }
  const referencia = tipoCambio.estado === "referencia"
  return (
    <span
      role="status"
      title={referencia ? "La fuente no responde: se usa la última cotización guardada." : undefined}
      className={cn(
        BASE,
        referencia
          ? "border-warning/30 bg-warning-50 text-warning-700 dark:bg-warning/10 dark:text-warning-500"
          : "bg-muted text-muted-foreground"
      )}
    >
      {referencia ? <AlertTriangle className="h-3 w-3 shrink-0" /> : <ArrowLeftRight className="h-3 w-3 shrink-0" />}
      <span className="truncate">
        {`${tipoCambio.moneda} ${etiquetaFuente(tipoCambio.fuente)} · ${formatCurrencyValue(tipoCambio.valor, monedaLocal as CurrencyCode)} · hace ${antiguedad(tipoCambio.en)}`}
      </span>
    </span>
  )
}
