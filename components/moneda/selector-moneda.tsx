"use client"

import { useId } from "react"
import { useMoneda } from "@/hooks/use-moneda"
import type { MonedaCatalogo } from "@/lib/currency/catalogo"

interface SelectorMonedaProps {
  value: MonedaCatalogo
  onChange: (moneda: MonedaCatalogo) => void
  disabled?: boolean
}

/** Moneda del precio de un ítem del catálogo: local o la divisa de la organización. */
export function SelectorMoneda({ value, onChange, disabled }: SelectorMonedaProps) {
  const id = useId()
  const { config } = useMoneda()
  if (!config) return null
  if (!config.habilitada && value === null) return null

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium">
        Moneda del precio
      </label>
      <select
        id={id}
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === "" ? null : (e.target.value as MonedaCatalogo))}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="">{config.monedaLocal} (local)</option>
        <option value={config.monedaExtranjera}>{config.monedaExtranjera}</option>
      </select>
      {!config.habilitada && (
        <p className="text-xs text-muted-foreground">
          La moneda extranjera está deshabilitada: podés volver a moneda local.
        </p>
      )}
    </div>
  )
}
