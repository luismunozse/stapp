"use client"

import { useState } from "react"
import useSWR from "swr"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Percent } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import { COMMISSION_ROLE_LABEL, ORDER_ACCRUAL_HINT, commissionKindLabel, type CommissionRow } from "@/lib/commissions/types"
import { orderCommissionKeyPrefix } from "@/lib/commissions/card-version"
import { orderBaseBreakdown } from "@/lib/commissions/breakdown"

type CommissionCardRow = CommissionRow & { beneficiarioNombre: string }

interface OrdenComisionCardProps {
  ordenId: string
  tecnicoId: string | null | undefined
  recibidoPorId: string | null | undefined
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

// The DB value passes through unvalidated: an unknown code gets no hint.
function accrualHint(code: string | null | undefined): string | null {
  if (!code || !Object.prototype.hasOwnProperty.call(ORDER_ACCRUAL_HINT, code)) return null
  return ORDER_ACCRUAL_HINT[code as keyof typeof ORDER_ACCRUAL_HINT]
}

function baseLabel(fila: CommissionCardRow): string {
  if (fila.pagado) return "Base"
  if (fila.baseTipo === "MANO_DE_OBRA") return "Mano de obra"
  if (fila.baseTipo === "MONTO_ORDEN") return "Monto de la orden"
  return "Base"
}

export function OrdenComisionCard({
  ordenId,
  tecnicoId,
  recibidoPorId,
  porcentajeComision,
  horasTrabajadas,
  version,
  onUpdateField,
  readOnly,
}: OrdenComisionCardProps) {
  const { formatPrice, formatDate } = useCurrency()
  const [pctInvalido, setPctInvalido] = useState(false)
  const { data, error, isLoading } = useSWR<{ filas: CommissionCardRow[] }>(
    tecnicoId || recibidoPorId ? `${orderCommissionKeyPrefix(ordenId)}v=${encodeURIComponent(version)}` : null,
    fetcher,
  )

  if (!tecnicoId && !recibidoPorId) return null

  const filas = data?.filas ?? []
  if (data && filas.length === 0 && !tecnicoId) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Percent className="h-4 w-4" />
          Comisiones
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <p className="text-sm text-destructive">No se pudo cargar la comisión.</p>
        ) : !data && isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : (
          filas.map((fila) => {
            const esTecnico = fila.rol === "TECNICO"
            const original = fila.tipo === "ORIGINAL"
            const pct = Number(fila.porcentaje ?? (esTecnico ? porcentajeComision : null) ?? 0)
            const etiqueta = commissionKindLabel(fila.tipo, fila.documentoTipo)
            const personaActual = esTecnico ? tecnicoId : recibidoPorId
            const hint = fila.devengada ? null : accrualHint(fila.motivoSinDevengo)
            const desglose = orderBaseBreakdown(fila)
            return (
              <div key={fila.clave} className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{`${COMMISSION_ROLE_LABEL[fila.rol] ?? ""} · ${fila.beneficiarioNombre}`}</span>
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
                {desglose.map((linea) => (
                  <div key={linea.key} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{linea.label}</span>
                    <span>{linea.subtracts ? "- " : ""}{formatPrice(linea.amount)}</span>
                  </div>
                ))}
                {original && (
                  <div className="flex justify-between text-sm font-medium pt-2 border-t">
                    <span>{baseLabel(fila)}</span>
                    <span>{formatPrice(fila.base ?? 0)}</span>
                  </div>
                )}

                {original && (
                  <div>
                    <Label className="text-xs text-muted-foreground">% Comisión</Label>
                    {readOnly || fila.pagado || !esTecnico ? (
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
                        aria-invalid={pctInvalido || undefined}
                        onChange={() => setPctInvalido(false)}
                        onBlur={(e) => {
                          const v = parseFloat(e.target.value)
                          // A blank or invalid value never saves: it would silently become 0.
                          if (!Number.isFinite(v)) {
                            e.target.value = String(pct)
                            setPctInvalido(true)
                            return
                          }
                          setPctInvalido(false)
                          const nuevo = Math.max(0, Math.min(100, v))
                          if (nuevo !== pct) onUpdateField("porcentajeComision", nuevo)
                        }}
                      />
                    )}
                    {pctInvalido && !readOnly && !fila.pagado && esTecnico && (
                      <p role="alert" className="mt-1 text-xs text-destructive">
                        Ingrese un porcentaje entre 0 y 100.
                      </p>
                    )}
                  </div>
                )}

                <div className="flex justify-between items-center pt-2 border-t">
                  <span className="font-semibold">Comisión</span>
                  <span className="text-lg font-semibold text-primary">{formatPrice(fila.monto)}</span>
                </div>

                {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
                {fila.pagado && fila.fechaPago && (
                  <p className="text-xs text-muted-foreground">Pagada el {formatDate(fila.fechaPago)}</p>
                )}
                {fila.pagado && fila.beneficiarioId !== personaActual && (
                  <p className="text-xs text-muted-foreground">Pagada a {fila.beneficiarioNombre}</p>
                )}
              </div>
            )
          })
        )}

        {tecnicoId && (
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
        )}
      </CardContent>
    </Card>
  )
}
