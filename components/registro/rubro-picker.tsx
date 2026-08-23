"use client"

import { Bike, Car, Refrigerator, Smartphone, Watch, Wrench, type LucideIcon } from "lucide-react"
import { listRubrosParaSelector } from "@/lib/rubros"
import { cn } from "@/lib/utils"

/**
 * Mapa local de íconos. El registro es la primera pantalla del producto, así que
 * evitamos el import dinámico de lucide y su flash de contenido vacío: son seis
 * opciones fijas y entran en el bundle sin costo real.
 */
const ICONOS: Record<string, LucideIcon> = {
  Smartphone,
  Refrigerator,
  Car,
  Bike,
  Watch,
  Wrench,
}

const RUBROS = listRubrosParaSelector()

interface RubroPickerProps {
  value: string
  onChange: (rubroId: string) => void
  disabled?: boolean
}

export function RubroPicker({ value, onChange, disabled }: RubroPickerProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Rubro del negocio"
      className="grid grid-cols-2 gap-2 sm:grid-cols-3"
    >
      {RUBROS.map((rubro) => {
        const Icono = ICONOS[rubro.icono] ?? Wrench
        const seleccionado = value === rubro.id

        return (
          <button
            key={rubro.id}
            type="button"
            role="radio"
            aria-checked={seleccionado}
            disabled={disabled}
            onClick={() => onChange(rubro.id)}
            title={rubro.descripcion}
            className={cn(
              "flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "disabled:cursor-not-allowed disabled:opacity-50",
              seleccionado
                ? "border-primary bg-primary/5 ring-1 ring-primary"
                : "border-input hover:border-primary/50 hover:bg-accent/50"
            )}
          >
            <Icono
              className={cn("h-5 w-5", seleccionado ? "text-primary" : "text-muted-foreground")}
              aria-hidden="true"
            />
            <span className="text-sm font-medium leading-tight">{rubro.nombre}</span>
            {rubro.ejemplos.length > 0 && (
              <span className="text-xs leading-tight text-muted-foreground">
                {rubro.ejemplos.slice(0, 3).join(" · ")}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
