"use client"

import { Bike, Car, Refrigerator, Smartphone, Watch, Wrench, type LucideIcon } from "lucide-react"
import { listRubrosParaSelector, DEFAULT_RUBRO_ID } from "@/lib/rubros"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
  /** Texto libre del rubro genérico. */
  detalle: string
  onDetalleChange: (detalle: string) => void
  disabled?: boolean
}

export function RubroPicker({
  value,
  onChange,
  detalle,
  onDetalleChange,
  disabled,
}: RubroPickerProps) {
  const esGenerico = value === DEFAULT_RUBRO_ID

  return (
    <div className="space-y-3">
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

      {esGenerico && (
        <div className="space-y-1.5 rounded-lg border border-primary/40 bg-primary/5 p-3">
          <Label htmlFor="rubroDetalle" className="text-sm font-medium">
            ¿Qué reparás?
          </Label>
          <Input
            id="rubroDetalle"
            value={detalle}
            onChange={(e) => onDetalleChange(e.target.value)}
            disabled={disabled}
            maxLength={120}
            placeholder="Ej: máquinas de café, cortadoras de pasto, cerraduras"
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            Con esto nombramos tus órdenes y tu ficha de trabajo. Si lo dejás
            vacío arrancás con una base neutral.
          </p>
        </div>
      )}
    </div>
  )
}
