"use client"

import { cn } from "@/lib/utils"

/**
 * Servicios y repuestos de una orden que ya tiene presupuesto (cotización
 * vigente): cada línea dice si ya está DENTRO del presupuesto o si suma aparte
 * al cobro (migración 421). La mayoría de los talleres carga en Repuestos lo
 * mismo que cotizó, para el stock y el costo; sumarlo duplicaría el cobro. Por
 * eso no se adivina: se pregunta al cargar y se puede cambiar después.
 */

/** Pregunta del formulario de alta. `value` null = todavía no eligió. */
export function PreguntaIncluidoEnPresupuesto({
  presupuestos,
  value,
  onChange,
  idPrefix,
}: {
  /** Números de las cotizaciones vigentes, p. ej. "COT-0059". */
  presupuestos: string
  value: boolean | null
  onChange: (incluido: boolean) => void
  idPrefix: string
}) {
  const opciones: Array<{ incluido: boolean; titulo: string; detalle: string }> = [
    { incluido: false, titulo: "Suma al cobro", detalle: "Es algo aparte del presupuesto" },
    { incluido: true, titulo: "Ya está en el presupuesto", detalle: "No se cobra dos veces" },
  ]
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-xs font-medium">
        Esta orden tiene presupuesto ({presupuestos}). ¿Esto ya está incluido?
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {opciones.map((o) => (
          <label
            key={String(o.incluido)}
            htmlFor={`${idPrefix}-incluido-${o.incluido}`}
            className={cn(
              "flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm transition-colors",
              value === o.incluido ? "border-primary bg-primary/5" : "hover:bg-muted/50"
            )}
          >
            <input
              id={`${idPrefix}-incluido-${o.incluido}`}
              type="radio"
              name={`${idPrefix}-incluido`}
              className="mt-0.5"
              checked={value === o.incluido}
              onChange={() => onChange(o.incluido)}
            />
            <span>
              <span className="block font-medium">{o.titulo}</span>
              <span className="block text-xs text-muted-foreground">{o.detalle}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/** Marca de una línea ya cargada; tocarla la cambia. */
export function MarcaIncluidoEnPresupuesto({
  incluido,
  disabled,
  onToggle,
}: {
  incluido: boolean
  disabled?: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onToggle}
      title={
        incluido
          ? "Está dentro del presupuesto: no suma aparte. Tocá para que sume al cobro."
          : "Suma al cobro, aparte del presupuesto. Tocá si ya está incluido en el presupuesto."
      }
      className={cn(
        "shrink-0 rounded px-1.5 py-0.5 text-xs transition-colors disabled:opacity-50",
        incluido
          ? "bg-muted text-muted-foreground hover:bg-muted/70"
          : "bg-primary/10 text-primary hover:bg-primary/20"
      )}
    >
      {incluido ? "En el presupuesto" : "Suma al cobro"}
    </button>
  )
}
