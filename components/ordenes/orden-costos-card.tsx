"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DollarSign } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"

interface OrdenCostosCardProps {
  ordenId: string
  presupuesto: number | null | undefined
  costoFinal: number | null | undefined
  sena: number
  totalCobrado?: number
  descuentoCobro?: number
  onUpdateField: (field: string, value: any) => void
}

export function OrdenCostosCard({
  ordenId,
  presupuesto,
  costoFinal,
  sena,
  totalCobrado = 0,
  descuentoCobro = 0,
  onUpdateField,
}: OrdenCostosCardProps) {
  const { formatPrice } = useCurrency()
  const pendienteReal = Math.max(0, (costoFinal || 0) - descuentoCobro - totalCobrado)

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
          <Label className="text-xs text-muted-foreground">Presupuesto</Label>
          <div className="flex gap-2 mt-1">
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
          </div>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Costo Final</Label>
          <div className="flex gap-2 mt-1">
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
          </div>
        </div>

        {costoFinal && costoFinal > 0 && (
          <div className="pt-3 border-t space-y-2">
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
          </div>
        )}
      </CardContent>
    </Card>
  )
}
