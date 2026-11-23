"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import { cn } from "@/lib/utils"
import { calcularDetalleCobro } from "@/lib/ordenes/detalle-cobro"

type DetalleInput = Parameters<typeof calcularDetalleCobro>[0]

/**
 * "Cuánto es cuánto" de la orden: cada ítem del presupuesto, servicio y
 * repuesto con su precio, costo y la ganancia estimada. Solo se monta para
 * ADMIN (lleva costos). La cuenta vive en lib/ordenes/detalle-cobro.ts.
 */
export function DetalleCobroOrden({ detalle }: { detalle: DetalleInput }) {
  const { formatPrice } = useCurrency()
  const [abierto, setAbierto] = useState(true)
  const d = calcularDetalleCobro(detalle)
  if (d.grupos.length === 0) return null

  return (
    <div className="pt-3 border-t">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="flex w-full items-center justify-between text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <span>Detalle y ganancia estimada</span>
        <ChevronDown className={cn("h-4 w-4 transition-transform", abierto && "rotate-180")} />
      </button>

      {abierto && (
        <div className="mt-2 space-y-3 text-sm">
          {d.grupos.map((g) => (
            <div key={g.titulo} className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">{g.titulo}</div>
              {g.filas.map((f) => (
                <div key={f.key} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className={cn("truncate", f.incluida && "text-muted-foreground")}>
                      {f.cantidad > 1 ? `${f.cantidad} × ` : ""}
                      {f.concepto}
                    </div>
                    {(f.costo !== null || f.incluida) && (
                      <div className="text-xs text-muted-foreground">
                        {f.incluida ? "En el presupuesto, no suma aparte" : null}
                        {f.incluida && f.costo !== null ? " · " : null}
                        {f.costo !== null ? `costo ${formatPrice(f.costo)}` : null}
                      </div>
                    )}
                  </div>
                  <span className={cn("shrink-0 tabular-nums", f.incluida && "text-muted-foreground")}>
                    {f.precio === null ? "—" : formatPrice(f.precio)}
                  </span>
                </div>
              ))}
            </div>
          ))}

          <div className="space-y-1 border-t pt-2">
            <div className="flex justify-between font-medium">
              <span>Total a cobrar</span>
              <span className="tabular-nums">{formatPrice(d.total)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Costo</span>
              <span className="tabular-nums">−{formatPrice(d.costo)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Ganancia estimada{d.margen !== null ? ` (${d.margen}%)` : ""}</span>
              <span className={cn("tabular-nums", d.ganancia < 0 ? "text-destructive-text" : "text-success-text")}>
                {formatPrice(d.ganancia)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
