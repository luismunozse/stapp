"use client"

import useSWR from "swr"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Percent } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import { COMMISSION_KIND_LABEL, type CommissionRow } from "@/lib/commissions/types"

type CommissionCardRow = CommissionRow & { beneficiarioNombre: string }

interface OrdenComisionCardProps {
  ordenId: string
  tecnicoId: string | null | undefined
  porcentajeComision: number | null | undefined
  horasTrabajadas?: number
  // Cache key only: changes whenever an input of the commission changes, so SWR refetches.
  version: string
  onUpdateField: (field: string, value: any) => void
  readOnly?: boolean
}

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error("No se pudo cargar la comisión.")
  return res.json()
}

export function OrdenComisionCard({
  ordenId,
  tecnicoId,
  porcentajeComision,
  horasTrabajadas,
  version,
  onUpdateField,
  readOnly,
}: OrdenComisionCardProps) {
  const { formatPrice, formatDate } = useCurrency()
  const { data, error, isLoading } = useSWR<{ filas: CommissionCardRow[] }>(
    tecnicoId ? `/api/comisiones/orden/${ordenId}?v=${encodeURIComponent(version)}` : null,
    fetcher,
  )

  if (!tecnicoId) return null

  const filas = data?.filas ?? []

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Percent className="h-4 w-4" />
          Comisión Técnico
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <p className="text-sm text-destructive">No se pudo cargar la comisión.</p>
        ) : !data && isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : (
          filas.map((fila) => {
            const pct = Number(fila.porcentaje ?? porcentajeComision ?? 0)
            const original = fila.tipo === "ORIGINAL"
            const etiqueta = COMMISSION_KIND_LABEL[fila.tipo]
            return (
              <div key={fila.clave} className="space-y-3">
                {(fila.pagado || !fila.devengada || etiqueta) && (
                  <div className="flex items-center gap-2">
                    {etiqueta && <span className="text-xs text-muted-foreground">{etiqueta}</span>}
                    {fila.pagado ? (
                      <Badge variant="success" showIcon className="gap-1 ml-auto">
                        Pagada
                      </Badge>
                    ) : !fila.devengada ? (
                      <Badge variant="secondary" className="ml-auto">
                        Proyectada
                      </Badge>
                    ) : null}
                  </div>
                )}
                {original && !fila.pagado && (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Costo final</span>
                      <span>{formatPrice(fila.documentoTotal ?? 0)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Repuestos</span>
                      <span>- {formatPrice(fila.documentoCostoRepuestos ?? 0)}</span>
                    </div>
                  </>
                )}
                {original && (
                  <div className="flex justify-between text-sm font-medium pt-2 border-t">
                    <span>Ganancia</span>
                    <span>{formatPrice(fila.base ?? 0)}</span>
                  </div>
                )}

                {original && (
                  <div>
                    <Label className="text-xs text-muted-foreground">% Comisión</Label>
                    {readOnly || fila.pagado ? (
                      <div className="h-9 px-3 flex items-center rounded-md border bg-muted/50 text-sm">
                        {pct.toFixed(2)}%
                      </div>
                    ) : (
                      <Input
                        key={`pct-${ordenId}-${pct}`}
                        aria-label="% Comisión"
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
                )}

                <div className="flex justify-between items-center pt-2 border-t">
                  <span className="font-semibold">Comisión</span>
                  <span className="text-lg font-semibold text-primary">{formatPrice(fila.monto)}</span>
                </div>

                {!fila.devengada && (
                  <p className="text-xs text-muted-foreground">
                    Se devenga cuando la orden está cobrada y además reparada o entregada.
                  </p>
                )}
                {fila.pagado && fila.fechaPago && (
                  <p className="text-xs text-muted-foreground">Pagada el {formatDate(fila.fechaPago)}</p>
                )}
                {fila.pagado && fila.beneficiarioId !== tecnicoId && (
                  <p className="text-xs text-muted-foreground">Pagada a {fila.beneficiarioNombre}</p>
                )}
              </div>
            )
          })
        )}

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
      </CardContent>
    </Card>
  )
}
