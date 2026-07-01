"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  PERIOD_PRESETS,
  detectPreset,
  type PeriodRange,
} from "@/lib/finanzas-period"

interface PeriodSelectorProps {
  value: PeriodRange
  onChange: (range: PeriodRange) => void
}

/**
 * Control de período compartido por la sección Finanzas.
 * Presets rápidos + rango manual desde/hasta. Fuente única de tiempo
 * para Estado de Resultados, Ingresos y Gastos.
 */
export function PeriodSelector({ value, onChange }: PeriodSelectorProps) {
  const activo = detectPreset(value)

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap gap-2">
            {PERIOD_PRESETS.map((p) => (
              <Button
                key={p.id}
                variant={activo === p.id ? "default" : "outline"}
                size="sm"
                onClick={() => onChange(p.range(new Date()))}
              >
                {p.label}
              </Button>
            ))}
          </div>

          <div className="ml-auto flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Desde</label>
              <Input
                type="date"
                value={value.desde}
                max={value.hasta}
                onChange={(e) => onChange({ ...value, desde: e.target.value })}
                className="w-auto"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Hasta</label>
              <Input
                type="date"
                value={value.hasta}
                min={value.desde}
                onChange={(e) => onChange({ ...value, hasta: e.target.value })}
                className="w-auto"
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
