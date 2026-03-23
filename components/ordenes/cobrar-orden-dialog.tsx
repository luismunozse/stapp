"use client"

import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { DollarSign, Loader2, ChevronDown, ChevronUp } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import { useOffline } from "@/contexts/offline-context"
import { STORES } from "@/lib/offline/constants"
import { MultiPagoInput, createPagoLine, type PagoLineItem } from "@/components/pagos/multi-pago-input"
import { PagosHistorial } from "@/components/facturacion/pagos-historial"

interface CobrarOrdenDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  orden: {
    id: string
    numeroOrden: number
    codigoOrden?: string
    costoFinal: number
    totalCobrado: number
    estadoCobro: string
    descuentoCobro: number
    clienteId?: string | null
    clienteNombre?: string
  }
  onSuccess: () => void
}

export function CobrarOrdenDialog({
  open,
  onOpenChange,
  orden,
  onSuccess,
}: CobrarOrdenDialogProps) {
  const { formatPrice } = useCurrency()
  const { offlineFetch } = useOffline()
  const [loading, setLoading] = useState(false)
  const [observaciones, setObservaciones] = useState("")
  const [descuento, setDescuento] = useState(0)
  const [saldoCuenta, setSaldoCuenta] = useState(0)
  const [cobrosHistorial, setCobrosHistorial] = useState<any[]>([])
  const [showHistorial, setShowHistorial] = useState(false)
  const [loadingHistorial, setLoadingHistorial] = useState(false)

  const costoConDescuento = orden.costoFinal - orden.descuentoCobro - descuento
  const pendiente = Math.max(0, costoConDescuento - orden.totalCobrado)

  const [pagosLines, setPagosLines] = useState<PagoLineItem[]>([createPagoLine(pendiente)])

  // Reset cuando cambia la orden o se abre
  useEffect(() => {
    if (open) {
      const p = Math.max(0, orden.costoFinal - orden.descuentoCobro - orden.totalCobrado)
      setPagosLines([createPagoLine(p)])
      setDescuento(0)
      setObservaciones("")
      fetchHistorial()
      fetchSaldoCuenta()
    }
  }, [open, orden.id])

  // Update pago amount when discount changes
  useEffect(() => {
    if (pagosLines.length === 1) {
      const p = Math.max(0, costoConDescuento - orden.totalCobrado)
      setPagosLines([{ ...pagosLines[0], monto: p }])
    }
  }, [descuento])

  const fetchSaldoCuenta = async () => {
    if (!orden.clienteId) return
    try {
      const res = await fetch(`/api/clientes/${orden.clienteId}/cuenta-corriente`)
      if (res.ok) {
        const data = await res.json()
        setSaldoCuenta(data.saldo || 0)
      }
    } catch { setSaldoCuenta(0) }
  }

  const fetchHistorial = async () => {
    setLoadingHistorial(true)
    try {
      const res = await fetch(`/api/ordenes/${orden.id}/cobros`)
      if (res.ok) {
        const data = await res.json()
        setCobrosHistorial(data)
      }
    } catch { /* ignore */ }
    finally { setLoadingHistorial(false) }
  }

  const handleCobrar = async () => {
    const totalPagos = pagosLines.reduce((sum, p) => sum + (p.monto || 0), 0)
    if (totalPagos <= 0) {
      alert("Debe registrar al menos un pago")
      return
    }
    if (totalPagos > pendiente + 0.01) {
      alert(`El total de pagos excede el pendiente (${formatPrice(pendiente)})`)
      return
    }

    const pagoCC = pagosLines.find(p => p.metodo === "CUENTA_CORRIENTE")
    if (pagoCC && pagoCC.monto > saldoCuenta) {
      alert(`Saldo insuficiente en cuenta corriente (${formatPrice(saldoCuenta)})`)
      return
    }

    setLoading(true)
    try {
      const cobrosBody = {
        pagos: pagosLines.map(p => ({
          monto: p.monto,
          metodo: p.metodo,
          referencia: p.referencia || null,
          cuotas: p.cuotas,
          recargo: p.recargo,
          montoOriginal: p.montoOriginal,
        })),
        observaciones: observaciones || undefined,
        descuento: descuento > 0 ? descuento : undefined,
      }

      const res = await offlineFetch(`/api/ordenes/${orden.id}/cobros`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cobrosBody),
      }, { store: STORES.COBROS, description: `Cobro orden #${orden.numeroOrden}` })

      if (res.status === 202) {
        alert("Cobro guardado offline. Se sincronizará automáticamente.")
        onSuccess()
        onOpenChange(false)
        return
      }

      if (!res.ok) {
        const error = await res.json()
        alert(error.error || "Error al registrar cobro")
        return
      }

      onSuccess()
      onOpenChange(false)
    } catch (err) {
      console.error("Error:", err)
      alert("Error al registrar cobro")
    } finally {
      setLoading(false)
    }
  }

  const ordenLabel = orden.codigoOrden || `#${String(orden.numeroOrden).padStart(4, "0")}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Cobrar Orden {ordenLabel}
            {orden.clienteNombre && (
              <span className="text-sm font-normal text-muted-foreground">
                - {orden.clienteNombre}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Resumen financiero */}
        <div className="p-3 bg-muted rounded-lg space-y-2">
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <span className="text-muted-foreground text-xs">Costo Final</span>
              <div className="font-semibold">{formatPrice(orden.costoFinal)}</div>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Cobrado</span>
              <div className="font-semibold text-green-600">{formatPrice(orden.totalCobrado)}</div>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Pendiente</span>
              <div className="font-semibold text-red-600">{formatPrice(pendiente)}</div>
            </div>
          </div>
          {(orden.descuentoCobro > 0 || descuento > 0) && (
            <div className="text-xs text-muted-foreground border-t pt-1">
              Descuento aplicado: {formatPrice(orden.descuentoCobro + descuento)}
            </div>
          )}
        </div>

        {pendiente <= 0 ? (
          <div className="text-center py-4">
            <Badge variant="success" className="text-base px-4 py-1">
              Cobrado en su totalidad
            </Badge>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Descuento al cobrar */}
            <div>
              <Label className="text-xs">Descuento al cobrar (opcional)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                max={orden.costoFinal - orden.descuentoCobro - orden.totalCobrado}
                value={descuento || ""}
                onChange={(e) => setDescuento(parseFloat(e.target.value) || 0)}
                placeholder="0.00"
              />
              {descuento > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  Nuevo pendiente: {formatPrice(pendiente)}
                </p>
              )}
            </div>

            {/* Saldo de cuenta corriente visible */}
            {!!orden.clienteId && saldoCuenta > 0 && (
              <div className="flex items-center justify-between p-2 rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-xs">
                <span className="text-blue-700 dark:text-blue-400">Saldo en cuenta corriente:</span>
                <span className="font-semibold text-blue-700 dark:text-blue-400">{formatPrice(saldoCuenta)}</span>
              </div>
            )}

            {/* Pagos */}
            <MultiPagoInput
              montoPendiente={pendiente}
              pagos={pagosLines}
              onChange={setPagosLines}
              saldoCuenta={saldoCuenta}
              showCuentaCorriente={!!orden.clienteId && saldoCuenta > 0}
            />

            {/* Observaciones */}
            <div>
              <Label className="text-xs">Observaciones</Label>
              <Textarea
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                placeholder="Notas del cobro..."
                rows={2}
              />
            </div>

            {/* Botón cobrar */}
            <Button
              className="w-full"
              onClick={handleCobrar}
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Registrando...
                </>
              ) : (
                `Cobrar ${formatPrice(pagosLines.reduce((s, p) => s + (p.monto || 0), 0))}`
              )}
            </Button>
          </div>
        )}

        {/* Historial de cobros */}
        {cobrosHistorial.length > 0 && (
          <div>
            <Button
              variant="ghost"
              className="w-full justify-between"
              onClick={() => setShowHistorial(!showHistorial)}
            >
              <span className="text-sm">
                Historial de cobros ({cobrosHistorial.filter((c: any) => !c.anulado).length})
                {cobrosHistorial.some((c: any) => c.anulado) && (
                  <span className="text-muted-foreground ml-1">
                    ({cobrosHistorial.filter((c: any) => c.anulado).length} anulados)
                  </span>
                )}
              </span>
              {showHistorial ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
            {showHistorial && (
              <div className="space-y-2 mt-2">
                <PagosHistorial pagos={cobrosHistorial.filter((c: any) => !c.anulado)} />
                {cobrosHistorial.filter((c: any) => c.anulado).length > 0 && (
                  <div className="text-xs text-muted-foreground pt-2 border-t">
                    <p className="font-medium mb-1">Cobros anulados:</p>
                    {cobrosHistorial.filter((c: any) => c.anulado).map((c: any) => (
                      <div key={c.id} className="flex justify-between line-through opacity-60">
                        <span>{c.metodoPago} - {formatPrice(c.monto)}</span>
                        <span>{c.anuladoMotivo || "Anulado"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
