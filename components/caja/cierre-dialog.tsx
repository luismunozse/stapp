"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Loader2, TrendingUp, TrendingDown, Minus } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import { parseMoneyInput } from "@/lib/parse-money"

interface CierreDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sesionId: string
  saldoInicial: number
  totalIngresosEfectivo: number
  totalEgresosEfectivo: number
  totalCostosFinancieros?: number
  onSuccess: () => void
}

export function CierreDialog({
  open,
  onOpenChange,
  sesionId,
  saldoInicial,
  totalIngresosEfectivo,
  totalEgresosEfectivo,
  totalCostosFinancieros = 0,
  onSuccess,
}: CierreDialogProps) {
  const { formatPrice } = useCurrency()
  const [conteoFisico, setConteoFisico] = useState("")
  const [observaciones, setObservaciones] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const esperado = saldoInicial + totalIngresosEfectivo - totalEgresosEfectivo
  const conteo = parseMoneyInput(conteoFisico || "0")
  const diferencia = conteo - esperado

  useEffect(() => {
    if (open) {
      setConteoFisico("")
      setObservaciones("")
      setError("")
    }
  }, [open])

  const handleSubmit = async () => {
    setError("")
    if (!conteoFisico || isNaN(conteo) || conteo < 0) {
      setError("Ingrese el conteo físico de efectivo")
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/caja/sesiones/${sesionId}/cerrar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conteoFisico: conteo, observaciones: observaciones || undefined }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Error al cerrar caja")
      }

      onOpenChange(false)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cerrar caja")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cerrar Caja - Arqueo</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Resumen de efectivo */}
          <div className="space-y-2 p-4 bg-muted rounded-lg">
            <div className="flex justify-between text-sm">
              <span>Saldo inicial</span>
              <span className="font-medium">{formatPrice(saldoInicial)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-success-600">+ Ingresos efectivo</span>
              <span className="font-medium text-success-600">{formatPrice(totalIngresosEfectivo)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-destructive">- Egresos efectivo</span>
              <span className="font-medium text-destructive">{formatPrice(totalEgresosEfectivo)}</span>
            </div>
            <div className="border-t pt-2 flex justify-between font-bold">
              <span>Efectivo esperado</span>
              <span>{formatPrice(esperado)}</span>
            </div>
            {totalCostosFinancieros > 0 && (
              <div className="border-t pt-2 mt-2">
                <div className="flex justify-between text-sm">
                  <span className="text-destructive">Costo terminales (tarjetas)</span>
                  <span className="font-medium text-destructive">-{formatPrice(totalCostosFinancieros)}</span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span className="font-medium">Ingreso real del día</span>
                  <span className="font-bold">{formatPrice(esperado - totalCostosFinancieros)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Conteo físico */}
          <div>
            <label className="text-sm font-medium">Conteo físico de efectivo</label>
            <Input
              type="text"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={conteoFisico}
              onChange={(e) => setConteoFisico(e.target.value)}
              className="mt-1"
              autoFocus
            />
          </div>

          {/* Diferencia */}
          {conteoFisico && (
            <div
              className={`flex items-center justify-between p-3 rounded-lg border-2 ${
                diferencia === 0
                  ? "border-success/30 bg-success-50 dark:bg-success/15"
                  : diferencia > 0
                  ? "border-warning/30 bg-warning-50 dark:bg-warning/10"
                  : "border-destructive/30 bg-destructive/10 dark:bg-destructive/15"
              }`}
            >
              <div className="flex items-center gap-2">
                {diferencia === 0 ? (
                  <Minus className="h-4 w-4 text-success-600" />
                ) : diferencia > 0 ? (
                  <TrendingUp className="h-4 w-4 text-warning-600" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-destructive" />
                )}
                <span className="text-sm font-medium">
                  {diferencia === 0
                    ? "Caja cuadrada"
                    : diferencia > 0
                    ? "Sobrante"
                    : "Faltante"}
                </span>
              </div>
              <span
                className={`font-bold ${
                  diferencia === 0
                    ? "text-success-600"
                    : diferencia > 0
                    ? "text-warning-600"
                    : "text-destructive"
                }`}
              >
                {formatPrice(Math.abs(diferencia))}
              </span>
            </div>
          )}

          {/* Observaciones */}
          <div>
            <label className="text-sm font-medium">Observaciones (opcional)</label>
            <Textarea
              placeholder="Notas sobre el cierre de caja..."
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              className="mt-1"
              rows={3}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Cerrar Caja
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
