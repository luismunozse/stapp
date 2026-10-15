"use client"

import { useState } from "react"
import { useCurrency } from "@/contexts/currency-context"
import { ORDEN_PAPEL_OPCIONES, normalizeOrdenPapel, ordenPdfUrl, parseOrdenPapel, type OrdenPapel } from "@/lib/orden-papel"

/**
 * Hoja de UNA impresión de la orden. Arranca en la que el taller configuró
 * (Configuración > Comprobantes) y, mientras nadie elija otra, la sigue: la config
 * carga después de la pantalla. Lo que se elige acá vale para esta pantalla y no
 * se guarda.
 *
 * `pdfUrl` SIEMPRE manda el tamaño que muestra el selector (?papel=), elegido o no.
 * Dejarlo al server cuando no se eligió hacía que pantalla e impresión pudieran
 * discrepar si el default de la pantalla estaba viejo (el taller guardó A6 y esta
 * pantalla todavía leía A4): lo que el usuario ve es lo que sale.
 */
export function useOrdenPapel() {
  const { ordenFormatoPapel } = useCurrency()
  const orgDefault = normalizeOrdenPapel(ordenFormatoPapel)
  const [elegido, setElegido] = useState<OrdenPapel | null>(null)
  const papel = elegido ?? orgDefault
  return {
    papel,
    orgDefault,
    setPapel: (nuevo: OrdenPapel) => setElegido(parseOrdenPapel(nuevo)),
    pdfUrl: (ordenId: string) => ordenPdfUrl(ordenId, papel),
  }
}

interface OrdenPapelSelectProps {
  value: OrdenPapel
  onChange: (papel: OrdenPapel) => void
  /** El default del taller: se marca en la lista para saber cuál es "lo de siempre". */
  orgDefault: OrdenPapel
  disabled?: boolean
  className?: string
}

/** <select> nativo: no hay valor vacío que un Select de Radix pueda devolver y blanquear. */
export function OrdenPapelSelect({ value, onChange, orgDefault, disabled, className }: OrdenPapelSelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(normalizeOrdenPapel(e.target.value))}
      disabled={disabled}
      aria-label="Tamaño de hoja para imprimir"
      title="Tamaño de hoja para esta impresión"
      className={className ?? "h-9 rounded-md border bg-background px-2 text-xs"}
    >
      {ORDEN_PAPEL_OPCIONES.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
          {o.value === orgDefault ? " · la del taller" : ""}
        </option>
      ))}
    </select>
  )
}
