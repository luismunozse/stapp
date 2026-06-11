"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { DollarSign, FileText, Lock } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"

interface OrdenCostosCardProps {
  ordenId: string
  presupuesto: number | null | undefined
  costoFinal: number | null | undefined
  horasTrabajadas?: number
  sena: number
  totalCobrado?: number
  descuentoCobro?: number
  estadoCobro?: string
  estado?: string
  origenPresupuesto?: "cotizacion" | "manual" | null
  onUpdateField: (field: string, value: any) => void
  onCobrar?: () => void
  readOnly?: boolean
}

export function OrdenCostosCard({
  ordenId,
  presupuesto,
  costoFinal,
  horasTrabajadas,
  sena,
  totalCobrado = 0,
  descuentoCobro = 0,
  estadoCobro,
  estado,
  origenPresupuesto,
  onUpdateField,
  onCobrar,
  readOnly,
}: OrdenCostosCardProps) {
  const { formatPrice } = useCurrency()
  const pendienteReal = Math.max(0, (costoFinal || 0) - descuentoCobro - totalCobrado)
  const fromCotizacion = origenPresupuesto === "cotizacion"
  const isLocked = fromCotizacion || readOnly

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <DollarSign className="h-4 w-4" />
          Presupuesto y Costos
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Label className="text-xs text-muted-foreground">Presupuesto</Label>
            {fromCotizacion && (
              <Badge variant="outline" className="text-[10px] h-4 gap-1">
                <FileText className="h-2.5 w-2.5" />
                Cotizacion
              </Badge>
            )}
          </div>
          {isLocked ? (
            <div className="flex items-center gap-2 h-9 px-3 rounded-md border bg-muted/50 text-sm">
              {fromCotizacion && <Lock className="h-3 w-3 text-muted-foreground" />}
              <span>{formatPrice(presupuesto || 0)}</span>
            </div>
          ) : (
            <Input
              key={`presupuesto-${ordenId}-${presupuesto}`}
              type="number"
              step="0.01"
              defaultValue={presupuesto || ""}
              placeholder="0.00"
              onBlur={(e) => {
                const value = parseFloat(e.target.value) || null
                if (value !== presupuesto) onUpdateField("presupuesto", value)
              }}
            />
          )}
        </div>

        <div>
          <div className="flex items-center gap-2 mb-1">
            <Label className="text-xs text-muted-foreground">Costo Final</Label>
            {fromCotizacion && (
              <Badge variant="outline" className="text-[10px] h-4 gap-1">
                <FileText className="h-2.5 w-2.5" />
                Cotizacion
              </Badge>
            )}
          </div>
          {isLocked ? (
            <div className="flex items-center gap-2 h-9 px-3 rounded-md border bg-muted/50 text-sm">
              {fromCotizacion && <Lock className="h-3 w-3 text-muted-foreground" />}
              <span>{formatPrice(costoFinal || 0)}</span>
            </div>
          ) : (
            <Input
              key={`costoFinal-${ordenId}-${costoFinal}`}
              type="number"
              step="0.01"
              defaultValue={costoFinal || ""}
              placeholder="0.00"
              onBlur={(e) => {
                const value = parseFloat(e.target.value) || null
                if (value !== costoFinal) onUpdateField("costoFinal", value)
              }}
            />
          )}
        </div>

        {!readOnly && (
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Horas trabajadas</Label>
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
          </div>
        )}

        {costoFinal && costoFinal > 0 && (
          <div className="pt-3 border-t space-y-2">
            {sena > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Sena</span>
                <span className="text-blue-600 font-medium">{formatPrice(sena)}</span>
              </div>
            )}
            {totalCobrado > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Cobrado</span>
                <span className="text-green-600 font-medium">{formatPrice(totalCobrado)}</span>
              </div>
            )}
            {descuentoCobro > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Descuento</span>
                <span className="text-muted-foreground">-{formatPrice(descuentoCobro)}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold">
              <span>{pendienteReal <= 0 ? "Cobrado" : "Pendiente"}</span>
              <span className={`text-lg ${pendienteReal <= 0 ? "text-green-600" : ""}`}>
                {formatPrice(pendienteReal)}
              </span>
            </div>
            {onCobrar && !readOnly && estado !== "CANCELADO" && estado !== "SIN_REPARACION" && (
              <Button
                onClick={onCobrar}
                className="w-full mt-3"
                variant={estadoCobro === "COBRADO" ? "outline" : "default"}
              >
                <DollarSign className="h-4 w-4 mr-2" />
                {estadoCobro === "COBRADO" ? "Ver Cobros" : "Cobrar"}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
