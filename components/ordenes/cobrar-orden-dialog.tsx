"use client"

import { useState, useEffect } from "react"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { DollarSign, Loader2, ChevronDown, ChevronUp } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import { useModal } from "@/contexts/modal-context"
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
  const { showError, showInfo } = useModal()
  const { offlineFetch } = useOffline()
  const [loading, setLoading] = useState(false)
  const [observaciones, setObservaciones] = useState("")
  const [descuento, setDescuento] = useState("")
  const [saldoCuenta, setSaldoCuenta] = useState(0)
  const [cobrosHistorial, setCobrosHistorial] = useState<any[]>([])
  const [cuotasPendientes, setCuotasPendientes] = useState<any[]>([])
  const [showHistorial, setShowHistorial] = useState(false)
  const [loadingHistorial, setLoadingHistorial] = useState(false)

  const [mostrarDescuento, setMostrarDescuento] = useState(false)

  const descuentoNum = parseFloat(descuento) || 0
  const costoConDescuento = orden.costoFinal - orden.descuentoCobro - descuentoNum
  const pendiente = Math.max(0, costoConDescuento - orden.totalCobrado)
  const yaCobradoTotal = orden.costoFinal - orden.descuentoCobro - orden.totalCobrado <= 0

  const [pagosLines, setPagosLines] = useState<PagoLineItem[]>([createPagoLine(pendiente)])

  // Reset cuando cambia la orden o se abre
  useEffect(() => {
    if (open) {
      const p = Math.max(0, orden.costoFinal - orden.descuentoCobro - orden.totalCobrado)
      setPagosLines([createPagoLine(p)])
      setDescuento("")
      setMostrarDescuento(false)
      setObservaciones("")
      fetchHistorial()
      fetchSaldoCuenta()
      fetchCuotas()
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

  const fetchCuotas = async () => {
    try {
      const res = await fetch(`/api/ordenes/${orden.id}/cuotas`)
      if (res.ok) {
        const data = await res.json()
        setCuotasPendientes(data.filter((c: any) => !c.pagada))
      }
    } catch { /* ignore */ }
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
      await showError("Debe registrar al menos un pago")
      return
    }
    if (totalPagos > pendiente + 0.01) {
      await showError(`El total de pagos excede el pendiente (${formatPrice(pendiente)})`)
      return
    }

    const pagoCC = pagosLines.find(p => p.metodo === "CUENTA_CORRIENTE")
    if (pagoCC && pagoCC.monto > saldoCuenta) {
      await showError(`Saldo insuficiente en cuenta corriente (${formatPrice(saldoCuenta)})`)
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
          costoFinanciero: p.costoFinanciero,
        })),
        observaciones: observaciones || undefined,
        descuento: descuentoNum > 0 ? descuentoNum : undefined,
      }

      const res = await offlineFetch(`/api/ordenes/${orden.id}/cobros`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cobrosBody),
      }, { store: STORES.COBROS, description: `Cobro orden #${orden.numeroOrden}` })

      if (res.status === 202) {
        await showInfo("Cobro guardado offline. Se sincronizará automáticamente.")
        onSuccess()
        onOpenChange(false)
        return
      }

      if (!res.ok) {
        const error = await res.json()
        await showError(error.error || "Error al registrar cobro")
        return
      }

      onSuccess()
      onOpenChange(false)
    } catch (err) {
      console.error("Error:", err)
      await showError("Error al registrar cobro")
    } finally {
      setLoading(false)
    }
  }

  const ordenLabel = orden.codigoOrden || `#${String(orden.numeroOrden).padStart(4, "0")}`

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Cobrar Orden {ordenLabel}
            {orden.clienteNombre && (
              <span className="text-sm font-normal text-muted-foreground">
                - {orden.clienteNombre}
              </span>
            )}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

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
          {(orden.descuentoCobro > 0 || descuentoNum > 0) && (
            <div className="text-xs text-muted-foreground border-t pt-1">
              Descuento aplicado: {formatPrice(orden.descuentoCobro + descuentoNum)}
            </div>
          )}
        </div>

        {yaCobradoTotal ? (
          <div className="text-center py-4">
            <Badge variant="success" className="text-base px-4 py-1">
              Cobrado en su totalidad
            </Badge>
          </div>
        ) : (
          <div className="space-y-4">
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

            {/* Descuento al cobrar (oculto detrás de un toggle para evitar tipeos accidentales) */}
            {!mostrarDescuento ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full text-xs text-muted-foreground"
                onClick={() => setMostrarDescuento(true)}
              >
                + Aplicar descuento
              </Button>
            ) : (
              <div>
                <Label className="text-xs">Descuento al cobrar (opcional)</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={descuento}
                  onChange={(e) => setDescuento(e.target.value)}
                  placeholder="0.00"
                  autoFocus
                />
                {descuentoNum > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Nuevo pendiente: {formatPrice(pendiente)}
                  </p>
                )}
              </div>
            )}

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
          </div>
        )}

        {/* Cuotas pendientes */}
        {cuotasPendientes.length > 0 && (
          <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 mb-2">
              Cuotas pendientes ({cuotasPendientes.length})
            </p>
            <div className="space-y-1.5">
              {cuotasPendientes.map((c: any) => (
                <div key={c.id} className="flex justify-between text-xs">
                  <span className="text-amber-700 dark:text-amber-400">
                    Cuota {c.numeroCuota}/{c.totalCuotas} — vence {new Date(c.fechaVencimiento).toLocaleDateString("es-AR")}
                  </span>
                  <span className="font-medium text-amber-800 dark:text-amber-300">
                    {formatPrice(c.monto)}
                  </span>
                </div>
              ))}
            </div>
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
        {/* CTA sticky: siempre alcanzable con el pulgar, sin tener que scrollear
            por encima de cuotas/historial */}
        {!yaCobradoTotal && (
          <div className="sticky bottom-0 -mx-5 border-t bg-card px-5 py-3 sm:-mx-6 sm:px-6">
            <Button
              className="w-full"
              onClick={handleCobrar}
              disabled={loading || pendiente <= 0}
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
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
