"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Percent, CheckCircle2 } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"

interface Repuesto {
  cantidad: number
  precioUnitario: number | string
}

interface OrdenComisionCardProps {
  ordenId: string
  tecnicoId: string | null | undefined
  costoFinal: number | null | undefined
  repuestos: Repuesto[]
  // Costo extra (cotizaciones aceptadas linkeadas a inventario).
  // Server lo precalcula con precio_compra; se suma al costo de repuestos_orden.
  costoRepuestosExtra?: number
  porcentajeComision: number | null | undefined
  comisionPagada?: boolean
  fechaPagoComision?: string | null
  horasTrabajadas?: number
  onUpdateField: (field: string, value: any) => void
  readOnly?: boolean
}

export function OrdenComisionCard({
  ordenId,
  tecnicoId,
  costoFinal,
  repuestos,
  costoRepuestosExtra,
  porcentajeComision,
  comisionPagada,
  fechaPagoComision,
  horasTrabajadas,
  onUpdateField,
  readOnly,
}: OrdenComisionCardProps) {
  const { formatPrice, formatDate } = useCurrency()
  const [editingPct, setEditingPct] = useState(false)

  if (!tecnicoId) return null

  const costoRepuestosBase = (repuestos || []).reduce(
    (acc, r) => acc + (Number(r.cantidad) || 0) * (Number(r.precioUnitario) || 0),
    0
  )
  const costoRepuestos = costoRepuestosBase + (Number(costoRepuestosExtra) || 0)
  const ganancia = Math.max(0, (costoFinal || 0) - costoRepuestos)
  const pct = Number(porcentajeComision ?? 0)
  const comision = Math.round(ganancia * pct) / 100

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Percent className="h-4 w-4" />
          Comisión Técnico
          {comisionPagada && (
            <Badge variant="success" showIcon className="gap-1 ml-auto">
              Pagada
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Costo final</span>
          <span>{formatPrice(costoFinal || 0)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Repuestos</span>
          <span>- {formatPrice(costoRepuestos)}</span>
        </div>
        <div className="flex justify-between text-sm font-medium pt-2 border-t">
          <span>Ganancia</span>
          <span>{formatPrice(ganancia)}</span>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">% Comisión</Label>
          {readOnly || comisionPagada ? (
            <div className="h-9 px-3 flex items-center rounded-md border bg-muted/50 text-sm">
              {pct.toFixed(2)}%
            </div>
          ) : (
            <Input
              key={`pct-${ordenId}-${pct}`}
              type="number"
              step="0.01"
              min="0"
              max="100"
              defaultValue={pct}
              onBlur={(e) => {
                const v = parseFloat(e.target.value)
                const nuevo = Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0
                if (nuevo !== pct) onUpdateField("porcentajeComision", nuevo)
              }}
            />
          )}
        </div>

        <div className="flex justify-between items-center pt-2 border-t">
          <span className="font-semibold">Comisión</span>
          <span className="text-lg font-semibold text-primary">{formatPrice(comision)}</span>
        </div>

        <div className="pt-2 border-t">
          <Label className="text-xs text-muted-foreground mb-1 block">Horas trabajadas</Label>
          {readOnly ? (
            <div className="h-9 px-3 flex items-center rounded-md border bg-muted/50 text-sm">
              {Number(horasTrabajadas || 0)}
            </div>
          ) : (
            <Input
              key={`horas-${ordenId}-${horasTrabajadas}`}
              type="number"
              step="0.25"
              min="0"
              defaultValue={horasTrabajadas || ""}
              placeholder="0"
              onBlur={(e) => {
                const value = parseFloat(e.target.value) || 0
                if (value !== (horasTrabajadas || 0)) onUpdateField("horasTrabajadas", value)
              }}
            />
          )}
        </div>

        {comisionPagada && fechaPagoComision && (
          <p className="text-xs text-muted-foreground">
            Pagada el {formatDate(fechaPagoComision)}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
