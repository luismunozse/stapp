"use client"

import { useState, useEffect, useMemo } from "react"
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
import {
  CreditCard,
  Loader2,
  Banknote,
  ArrowDownUp,
  CheckCircle2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useCurrency } from "@/contexts/currency-context"
import { useModal } from "@/contexts/modal-context"
import { MultiPagoInput, createPagoLine, type PagoLineItem } from "@/components/pagos/multi-pago-input"
import type { PosCartItem, PosCliente } from "./pos-types"

interface PosCheckoutDialogProps {
  open: boolean
  onClose: () => void
  items: PosCartItem[]
  cliente: PosCliente
  onComplete: (ventaData: any) => void
}

export function PosCheckoutDialog({
  open,
  onClose,
  items,
  cliente,
  onComplete,
}: PosCheckoutDialogProps) {
  const { formatPrice } = useCurrency()
  const { showError } = useModal()
  const [loading, setLoading] = useState(false)
  const [pagosLines, setPagosLines] = useState<PagoLineItem[]>([createPagoLine(0)])
  const [observaciones, setObservaciones] = useState("")
  const [saldoCuenta, setSaldoCuenta] = useState(0)
  const [pagoParcial, setPagoParcial] = useState(false)

  // Cash change calculation
  const [montoRecibido, setMontoRecibido] = useState<number | "">("")

  const subtotal = items.reduce((sum, item) => sum + item.precioUnitario * item.cantidad, 0)
  const total = subtotal

  const isCashOnly = pagosLines.length === 1 && pagosLines[0].metodo === "EFECTIVO"
  const vuelto = useMemo(() => {
    if (!isCashOnly || montoRecibido === "") return 0
    return Math.max(0, montoRecibido - total)
  }, [isCashOnly, montoRecibido, total])

  // Update pagos amount when total changes
  useEffect(() => {
    if (open && total > 0) {
      setPagosLines([createPagoLine(total)])
      setMontoRecibido("")
      setObservaciones("")
      setPagoParcial(false)
    }
  }, [open, total])

  // Fetch account balance when client changes
  useEffect(() => {
    if (!cliente.id) {
      setSaldoCuenta(0)
      return
    }
    const fetchSaldo = async () => {
      try {
        const res = await fetch(`/api/clientes/${cliente.id}/cuenta-corriente`)
        if (res.ok) {
          const data = await res.json()
          setSaldoCuenta(data.saldo || 0)
        }
      } catch {
        setSaldoCuenta(0)
      }
    }
    fetchSaldo()
  }, [cliente.id])

  const handleSubmit = async () => {
    const totalPagos = pagosLines.reduce((sum, p) => sum + (p.monto || 0), 0)

    // Without partial payment, pagos must match total exactly
    if (!pagoParcial && Math.abs(totalPagos - total) > 0.01) {
      await showError(
        `El total de pagos (${formatPrice(totalPagos)}) no coincide con el total (${formatPrice(total)}). Active "Pago parcial" para dejar saldo pendiente.`
      )
      return
    }
    // With partial payment, pagos can be 0 (paga despues) but not exceed total
    if (pagoParcial && totalPagos > total + 0.01) {
      await showError("El total de pagos no puede exceder el total de la venta")
      return
    }

    // Validate cuenta corriente
    const pagoCC = pagosLines.find((p) => p.metodo === "CUENTA_CORRIENTE")
    if (pagoCC && pagoCC.monto > saldoCuenta) {
      await showError(`Saldo insuficiente en cuenta corriente (${formatPrice(saldoCuenta)})`)
      return
    }
    if (pagoCC && !cliente.id) {
      await showError("Seleccione un cliente registrado para usar cuenta corriente")
      return
    }

    setLoading(true)
    try {
      // Filter out pago lines with 0 amount
      const pagosConMonto = pagosLines.filter((p) => p.monto > 0)

      const payload = {
        clienteId: cliente.id || null,
        clienteNombre: cliente.nombre || "Consumidor Final",
        clienteTelefono: cliente.telefono || undefined,
        pagosParcial: pagoParcial,
        items: items.map((item) => ({
          inventarioId: item.inventarioId || null,
          descripcion: item.nombre,
          cantidad: item.cantidad,
          precioUnitario: item.precioUnitario,
          diasGarantia: item.diasGarantia,
          descuento: 0,
          tipoDescuento: "MONTO" as const,
          porcentajeDescuento: 0,
        })),
        descuento: 0,
        tipoDescuento: "MONTO" as const,
        porcentajeDescuento: 0,
        metodoPago: pagosConMonto.length > 0 ? pagosConMonto[0].metodo : "EFECTIVO",
        observaciones: observaciones || undefined,
        ...(pagosConMonto.length > 0 && {
          pagos: pagosConMonto.map((p) => ({
            metodo: p.metodo,
            monto: p.monto,
            ...(p.referencia && { referencia: p.referencia }),
            ...(p.cuotas && { cuotas: p.cuotas }),
            ...(p.recargo && { recargo: p.recargo }),
            ...(p.montoOriginal && { montoOriginal: p.montoOriginal }),
          })),
        }),
      }

      const res = await fetch("/api/ventas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const error = await res.json()
        await showError(error.error || "Error al crear la venta")
        return
      }

      const ventaData = await res.json()
      onComplete(ventaData)
    } catch (error) {
      console.error("Error creating venta:", error)
      await showError("Error al crear la venta")
    } finally {
      setLoading(false)
    }
  }

  // Quick cash amounts
  const quickAmounts = useMemo(() => {
    if (!isCashOnly) return []
    const rounded = Math.ceil(total / 100) * 100
    const amounts = [total]
    if (rounded !== total) amounts.push(rounded)
    if (rounded + 500 <= total * 3) amounts.push(rounded + 500)
    if (rounded + 1000 <= total * 3) amounts.push(rounded + 1000)
    return [...new Set(amounts)]
  }, [total, isCashOnly])

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Cobrar Venta
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Sale summary */}
          <div className="rounded-lg bg-muted/50 p-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-muted-foreground">
                {items.reduce((s, i) => s + i.cantidad, 0)} productos
              </span>
              {cliente.nombre && (
                <Badge variant="outline" className="text-xs">
                  {cliente.nombre}
                </Badge>
              )}
            </div>
            <div className="flex justify-between items-center">
              <span className="text-lg font-semibold">Total a cobrar</span>
              <span className="text-2xl font-bold text-primary">{formatPrice(total)}</span>
            </div>
          </div>

          {/* Quick action: Paga despues */}
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                className="rounded border-gray-300 h-4 w-4"
                checked={pagoParcial}
                onChange={(e) => {
                  setPagoParcial(e.target.checked)
                  if (!e.target.checked) {
                    // Restore full amount on first pago line
                    setPagosLines([createPagoLine(total)])
                  }
                }}
              />
              <span className="text-sm text-muted-foreground">
                Pago parcial
              </span>
            </label>
            {!pagoParcial && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs text-amber-600 border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                onClick={() => {
                  setPagoParcial(true)
                  setPagosLines([createPagoLine(0)])
                }}
              >
                Paga después ($0)
              </Button>
            )}
          </div>

          {/* Payment method - hidden when fully deferred */}
          {!(pagoParcial && pagosLines.length === 1 && (pagosLines[0].monto || 0) === 0) ? (
          <div className="space-y-3">
            <Label className="text-sm font-medium">Método de pago</Label>
            <MultiPagoInput
              montoPendiente={total}
              pagos={pagosLines}
              onChange={setPagosLines}
              saldoCuenta={saldoCuenta}
              showCuentaCorriente={!!cliente.id && saldoCuenta > 0}
            />
          </div>
          ) : (
            <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-4 text-center space-y-2">
              <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                Venta sin pago — el total queda pendiente
              </p>
              <p className="text-2xl font-bold text-red-600">{formatPrice(total)}</p>
              <p className="text-xs text-muted-foreground">
                El cobro se registra después desde el detalle de la venta
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => {
                  setPagosLines([createPagoLine(total)])
                }}
              >
                Quiero registrar un pago parcial
              </Button>
            </div>
          )}

          {/* Partial payment summary */}
          {pagoParcial && (() => {
            const totalPagos = pagosLines.reduce((sum, p) => sum + (p.monto || 0), 0)
            const pendiente = total - totalPagos
            return (pendiente > 0.01 && totalPagos > 0) ? (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total pagos:</span>
                  <span className="font-medium text-green-600">{formatPrice(totalPagos)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Saldo pendiente:</span>
                  <span className="font-bold text-red-600">{formatPrice(pendiente)}</span>
                </div>
              </div>
            ) : null
          })()}

          {/* Cash change calculator */}
          {isCashOnly && (
            <div className="rounded-lg border-2 border-dashed border-green-300 dark:border-green-800 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Banknote className="h-4 w-4 text-green-600" />
                <Label className="text-sm font-medium text-green-700 dark:text-green-400">
                  Cálculo de vuelto
                </Label>
              </div>

              {/* Quick amounts */}
              <div className="flex flex-wrap gap-1.5">
                {quickAmounts.map((amount) => (
                  <Button
                    key={amount}
                    type="button"
                    variant={montoRecibido === amount ? "default" : "outline"}
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setMontoRecibido(amount)}
                  >
                    {formatPrice(amount)}
                  </Button>
                ))}
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={montoRecibido}
                    onChange={(e) => setMontoRecibido(e.target.value ? parseFloat(e.target.value) : "")}
                    placeholder="Monto recibido"
                    className="h-10 text-lg font-medium"
                    autoFocus
                  />
                </div>
                <ArrowDownUp className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className={cn(
                  "text-right min-w-[100px]",
                  vuelto > 0 ? "text-green-600" : "text-muted-foreground"
                )}>
                  <div className="text-xs text-muted-foreground">Vuelto</div>
                  <div className="text-xl font-bold">{formatPrice(vuelto)}</div>
                </div>
              </div>

              {montoRecibido !== "" && montoRecibido < total && (
                <p className="text-xs text-red-500">
                  Faltan {formatPrice(total - montoRecibido)}
                </p>
              )}
            </div>
          )}

          {/* Observaciones */}
          <div>
            <Label className="text-xs">Observaciones (opcional)</Label>
            <Textarea
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              placeholder="Notas de la venta..."
              rows={2}
              className="mt-1"
            />
          </div>

          {/* Submit */}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={loading}>
              Cancelar
            </Button>
            <Button
              className="flex-1 h-12 text-base font-semibold"
              onClick={handleSubmit}
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Procesando...
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-5 w-5" />
                  Confirmar Venta
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
