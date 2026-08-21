"use client"

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

export function CamposExtraFields({ campos, values, config, onChange }: CamposExtraFieldsProps) {
  const visibles = campos.filter((c) => !c.usarComoDispositivo)

  // Render a dynamic extra field based on its config
  const renderCampoExtra = (campo: CampoExtra) => {
    const value = values[campo.key] ?? ""

    switch (campo.tipo) {
      case "text":
        return (
          <div key={campo.key}>
            <Label className="text-xs">{campo.label}</Label>
            <Input
              value={value}
              onChange={(e) => onChange(campo, e.target.value)}
              placeholder={campo.placeholder || ""}
              className="h-9"
            />
          </div>
        )

      case "select":
        return (
          <div key={campo.key}>
            <Label className="text-xs">{campo.label}</Label>
            <Select
              value={value || ""}
              onValueChange={(v) => onChange(campo, v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar..." />
              </SelectTrigger>
              <SelectContent>
                {(campo.opciones || []).map((op) => (
                  <SelectItem key={op} value={op}>{op}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )

      case "buttons":
        return (
          <div key={campo.key}>
            <Label className="text-xs">{campo.label}</Label>
            <div className="flex flex-wrap gap-1 mt-1">
              {(campo.opciones || []).map((op) => (
                <button
                  key={op}
                  type="button"
                  onClick={() => onChange(campo, op)}
                  className={`px-2 py-1 text-xs rounded border transition-colors ${
                    value === op
                      ? "bg-primary text-primary-foreground border-primary"
                      : "hover:bg-muted"
                  }`}
                >
                  {op}
                </button>
              ))}
            </div>
          </div>
        )

      case "counter":
        return (
          <div key={campo.key}>
            <Label className="text-xs">{campo.label}</Label>
            <div className="flex gap-1 mt-1">
              {Array.from(
                { length: (campo.max ?? 4) - (campo.min ?? 0) + 1 },
                (_, i) => (campo.min ?? 0) + i
              ).map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => onChange(campo, num)}
                  className={`w-10 h-10 rounded border font-medium transition-colors ${
                    value === num
                      ? "bg-primary text-primary-foreground border-primary"
                      : "hover:bg-muted"
                  }`}
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
    <div className={`border rounded-lg p-4 space-y-4 ${
      config.infoSectionColor === "blue" ? "bg-blue-50/30 dark:bg-blue-950/20" :
      config.infoSectionColor === "purple" ? "bg-purple-50/30 dark:bg-purple-950/20" :
      "bg-muted/30"
    }`}>
      <h4 className="font-medium text-sm flex items-center gap-2">
        {config.infoSectionIcon && <span>{config.infoSectionIcon}</span>}
        {config.infoSectionTitle || "Informacion Adicional"}
      </h4>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {visibles.map(renderCampoExtra)}
      </div>
    </div>
  )
}
