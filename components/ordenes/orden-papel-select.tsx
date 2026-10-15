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
 * `pdfUrl` no manda ningún tamaño mientras no se haya elegido: el servidor usa el
 * default del taller. Si se eligió uno, viaja como ?papel= (aunque coincida con el
 * default: lo que el usuario ve en el selector es lo que sale).
 */
export function useOrdenPapel() {
  const { ordenFormatoPapel } = useCurrency()
  const orgDefault = normalizeOrdenPapel(ordenFormatoPapel)
  const [elegido, setElegido] = useState<OrdenPapel | null>(null)
  return {
    papel: elegido ?? orgDefault,
    orgDefault,
    setPapel: (papel: OrdenPapel) => setElegido(parseOrdenPapel(papel)),
    pdfUrl: (ordenId: string) => ordenPdfUrl(ordenId, elegido),
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
