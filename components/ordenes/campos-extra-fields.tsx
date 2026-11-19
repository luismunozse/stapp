"use client"

import { useEffect, useRef, useState } from "react"
import { X } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { CampoExtra, TipoDispositivoConfig } from "@/types"

interface CamposExtraFieldsProps {
  campos: CampoExtra[]
  values: Record<string, any>
  config: TipoDispositivoConfig
  /** Recibe el campo completo: el padre necesita `usarComoDispositivo` y `autoMarca`. */
  onChange: (campo: CampoExtra, value: any) => void
}

/** Valor centinela del item "Otro…": nunca se guarda, solo cambia a modo manual. */
const OTRO = "__otro__"

const chipClass = (activo: boolean) =>
  `rounded border transition-colors ${
    activo ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"
  }`

/**
 * Select con salida a texto libre: las opciones son sugerencias, no una lista
 * cerrada (ej. RAM "3GB"). Un valor que no esta en la lista —elegido con
 * "Otro…" o ya guardado en la orden— se muestra como input editable.
 */
function SelectConOtro({
  campo,
  value,
  onChange,
}: {
  campo: CampoExtra
  value: string
  onChange: (value: string) => void
}) {
  const opciones = campo.opciones || []
  const fueraDeLista = value !== "" && !opciones.includes(value)
  // Un valor fuera de lista que llega desde afuera (borrador restaurado,
  // edicion de una orden existente) tiene que verse, no quedar como vacio.
  const [eligioOtro, setEligioOtro] = useState(false)
  const manual = eligioOtro || fueraDeLista
  const inputRef = useRef<HTMLInputElement>(null)
  const enfocarAlMontar = useRef(false)

  useEffect(() => {
    if (manual && enfocarAlMontar.current) {
      enfocarAlMontar.current = false
      inputRef.current?.focus()
    }
  }, [manual])

  if (manual) {
    return (
      <div className="relative">
        <Input
          ref={inputRef}
          id={`campo-extra-${campo.key}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Escribir..."
          className="pr-9"
        />
        <button
          type="button"
          aria-label={`Volver a la lista de ${campo.label}`}
          title="Volver a la lista"
          onClick={() => {
            onChange("")
            setEligioOtro(false)
          }}
          className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return (
    <Select
      value={value}
      onValueChange={(v) => {
        if (v === OTRO) {
          enfocarAlMontar.current = true
          setEligioOtro(true)
          onChange("")
          return
        }
        onChange(v)
      }}
    >
      <SelectTrigger id={`campo-extra-${campo.key}`}>
        <SelectValue placeholder="Seleccionar..." />
      </SelectTrigger>
      <SelectContent>
        {opciones.map((op) => (
          <SelectItem key={op} value={op}>{op}</SelectItem>
        ))}
        <SelectItem value={OTRO}>Otro…</SelectItem>
      </SelectContent>
    </Select>
  )
}

export function CamposExtraFields({ campos, values, config, onChange }: CamposExtraFieldsProps) {
  const visibles = campos.filter((c) => !c.usarComoDispositivo)

  // Render a dynamic extra field based on its config
  const renderCampoExtra = (campo: CampoExtra) => {
    const value = values[campo.key] ?? ""

    switch (campo.tipo) {
      case "text":
        return (
          <div key={campo.key} className="space-y-1.5">
            <Label htmlFor={`campo-extra-${campo.key}`} className="text-xs">{campo.label}</Label>
            <Input
              id={`campo-extra-${campo.key}`}
              value={value}
              onChange={(e) => onChange(campo, e.target.value)}
              placeholder={campo.placeholder || ""}
            />
          </div>
        )

      case "select":
        return (
          <div key={campo.key} className="space-y-1.5">
            <Label htmlFor={`campo-extra-${campo.key}`} className="text-xs">{campo.label}</Label>
            <SelectConOtro
              campo={campo}
              value={typeof value === "string" ? value : ""}
              onChange={(v) => onChange(campo, v)}
            />
          </div>
        )

      // Botones y contador ocupan la fila entera: dentro de una columna de la
      // grilla se apilan en varios renglones y estiran el formulario.
      case "buttons":
        return (
          <div key={campo.key} className="col-span-full space-y-1.5">
            <Label className="text-xs">{campo.label}</Label>
            <div className="flex flex-wrap gap-1.5">
              {(campo.opciones || []).map((op) => (
                <button
                  key={op}
                  type="button"
                  onClick={() => onChange(campo, op)}
                  aria-pressed={value === op}
                  className={`px-3 py-1.5 text-xs ${chipClass(value === op)}`}
                >
                  {op}
                </button>
              ))}
            </div>
          </div>
        )

      case "counter":
        return (
          <div key={campo.key} className="col-span-full space-y-1.5">
            <Label className="text-xs">{campo.label}</Label>
            <div className="flex gap-1.5">
              {Array.from(
                { length: (campo.max ?? 4) - (campo.min ?? 0) + 1 },
                (_, i) => (campo.min ?? 0) + i
              ).map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => onChange(campo, num)}
                  aria-pressed={value === num}
                  className={`h-10 w-10 font-medium ${chipClass(value === num)}`}
                >
                  {num}
                </button>
              ))}
            </div>
          </div>
        )

      default:
        return null
    }
  }

  if (visibles.length === 0) return null

  return (
    <div className={`border rounded-lg p-4 space-y-3 ${
      config.infoSectionColor === "blue" ? "bg-blue-50/30 dark:bg-blue-950/20" :
      config.infoSectionColor === "purple" ? "bg-purple-50/30 dark:bg-purple-950/20" :
      "bg-muted/30"
    }`}>
      <h4 className="font-medium text-sm flex items-center gap-2">
        {config.infoSectionIcon && <span>{config.infoSectionIcon}</span>}
        {config.infoSectionTitle || "Información adicional"}
      </h4>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {visibles.map(renderCampoExtra)}
      </div>
    </div>
  )
}
