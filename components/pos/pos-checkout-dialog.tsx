"use client"

import { useState, useEffect, useMemo } from "react"
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
import type { PosCartItem, PosCliente, DescuentoConfig, FiscalConfig } from "./pos-types"
import { computeVentaTotals } from "./pos-types"
import { buildVentaPayload } from "./pos-payload"
import { TotalRow } from "@/components/pos/total-row"

interface PosCheckoutDialogProps {
  open: boolean
  onClose: () => void
  items: PosCartItem[]
  cliente: PosCliente
  onComplete: (ventaData: any) => void
  descuentoGlobal?: DescuentoConfig | null
  descuentoMotivo?: string
  fiscal?: FiscalConfig | null
}

export function PosCheckoutDialog({
  open,
  onClose,
  items,
  cliente,
  onComplete,
  descuentoGlobal = null,
  descuentoMotivo,
  fiscal = null,
}: PosCheckoutDialogProps) {
  const { formatPrice } = useCurrency()
  const { showError } = useModal()
  const [loading, setLoading] = useState(false)
  const [pagosLines, setPagosLines] = useState<PagoLineItem[]>([createPagoLine(0)])
  const [observaciones, setObservaciones] = useState("")
  const [saldoCuenta, setSaldoCuenta] = useState(0)
  const [pagoParcial, setPagoParcial] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState<string>("")

  // Cash change calculation
  const [montoRecibido, setMontoRecibido] = useState<number | "">("")

  // roundCash = all payment lines are EFECTIVO (mirrors backend isCash logic)
  const isCashOnly = pagosLines.length === 1 && pagosLines[0].metodo === "EFECTIVO"
  const allCash = pagosLines.length > 0 && pagosLines.every((p) => p.metodo === "EFECTIVO")
  const t = computeVentaTotals(items, descuentoGlobal, fiscal, allCash)
  const total = t.total
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
      setIdempotencyKey(crypto.randomUUID())
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
    // Validate against base amounts (recargo is bank interest, not store income)
    const totalPagosBase = pagosLines.reduce((sum, p) => sum + (p.monto || 0), 0)

    // Without partial payment, base pagos must match total exactly
    if (!pagoParcial && Math.abs(totalPagosBase - total) > 0.01) {
      await showError(
        `El total de pagos (${formatPrice(totalPagosBase)}) no coincide con el total (${formatPrice(total)}). Active "Pago parcial" para dejar saldo pendiente.`
      )
      return
    }
    // With partial payment, base pagos can be 0 but not exceed total
    if (pagoParcial && totalPagosBase > total + 0.01) {
      await showError("El total de pagos no puede exceder el total de la venta")
      return
    }

    // A sale with pending balance requires a registered client (cuenta corriente)
    const saldoPendiente = total - totalPagosBase
    if (pagoParcial && saldoPendiente > 0.01 && !cliente.id) {
      await showError("Seleccioná un cliente para dejar saldo pendiente / fiar")
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

    // Validar selección de series para items serializados
    const itemSinSeries = items.find(
      (it) => it.trackeaSeries && it.serieIds.length !== it.cantidad
    )
    if (itemSinSeries) {
      await showError(
        `Seleccioná ${itemSinSeries.cantidad} serie(s) para "${itemSinSeries.nombre}" antes de cobrar`
      )
      return
    }

    // Pre-checkout stock re-validation (fail-open: RPC is the real guard)
    const invItems = items.filter((i) => i.inventarioId)
    if (invItems.length > 0) {
      const ids = invItems.map((i) => i.inventarioId!)
      try {
        const stockRes = await fetch("/api/inventario/check-stock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        })
        if (stockRes.ok) {
          const stockData = await stockRes.json()
          const stock: Record<string, number> = stockData.stock ?? {}
          // Sum requested quantities per inventarioId
          const pedidoPorId: Record<string, number> = {}
          const nombrePorId: Record<string, string> = {}
          for (const item of invItems) {
            const id = item.inventarioId!
            pedidoPorId[id] = (pedidoPorId[id] ?? 0) + item.cantidad
            nombrePorId[id] = item.nombre
          }
          const conflicts: string[] = []
          for (const [id, pedido] of Object.entries(pedidoPorId)) {
            const disponible = stock[id] ?? 0
            if (pedido > disponible) {
              conflicts.push(`${nombrePorId[id]}: pedís ${pedido}, hay ${disponible}`)
            }
          }
          if (conflicts.length > 0) {
            setLoading(false)
            await showError(`Stock insuficiente:\n${conflicts.join("\n")}`)
            return
          }
        }
        // If !stockRes.ok → fail open, continue with sale
      } catch {
        // Network/fetch error → fail open, continue with sale
      }
    }

    setLoading(true)
    try {
      const payload = buildVentaPayload({
        items,
        cliente,
        pagosLines,
        pagoParcial,
        observaciones,
        idempotencyKey,
        descuentoGlobal,
        ...(descuentoMotivo ? { descuentoMotivo } : {}),
      })

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

  // Whether the confirm button should be blocked due to missing client for pending balance
  const pendienteRequiereCliente = useMemo(() => {
    const totalPagosBase = pagosLines.reduce((sum, p) => sum + (p.monto || 0), 0)
    const saldoPendiente = total - totalPagosBase
    return pagoParcial && saldoPendiente > 0.01 && !cliente.id
  }, [pagoParcial, pagosLines, total, cliente.id])

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
    <ResponsiveDialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <ResponsiveDialogContent className="sm:max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Cobrar Venta
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

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
            {(t.descuentoTotal > 0 || t.iva > 0 || t.redondeo !== 0) && (
              <div className="space-y-1 mb-2">
                {t.descuentoTotal > 0 && (
                  <>
                    <TotalRow label="Subtotal" amount={formatPrice(t.subtotal)} />
                    <TotalRow label="Descuento" amount={`- ${formatPrice(t.descuentoTotal)}`} tone="success" />
                  </>
                )}
                {t.iva > 0 && (
                  <>
                    <TotalRow label="Neto" amount={formatPrice(t.neto)} />
                    <TotalRow label={`IVA (${fiscal?.tasa ?? 0}%)`} amount={formatPrice(t.iva)} />
                  </>
                )}
                {t.redondeo !== 0 && (
                  <TotalRow
                    label="Redondeo efectivo"
                    amount={(t.redondeo >= 0 ? "+" : "") + formatPrice(t.redondeo)}
                  />
                )}
              </div>
            )}
            <TotalRow label="Total a cobrar" amount={formatPrice(total)} emphasis />
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
                className="h-7 text-xs text-warning border-warning/40 hover:bg-warning-50"
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
            <div className="rounded-lg bg-warning-50 border border-warning/30 p-4 text-center space-y-2">
              <p className="text-sm font-medium text-warning">
                Venta sin pago — el total queda pendiente
              </p>
              <p className="text-2xl font-bold text-destructive">{formatPrice(total)}</p>
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
            const totalPagosBase = pagosLines.reduce((sum, p) => sum + (p.monto || 0), 0)
            const pendiente = total - totalPagosBase
            return (pendiente > 0.01 && totalPagosBase > 0) ? (
              <div className="rounded-lg bg-warning-50 border border-warning/30 p-3 space-y-1">
                <TotalRow label="Total pagos:" amount={formatPrice(totalPagosBase)} tone="success" />
                <TotalRow label="Saldo pendiente:" amount={formatPrice(pendiente)} tone="danger" />
              </div>
            ) : null
          })()}

          {/* Cash change calculator */}
          {isCashOnly && (
            <div className="rounded-lg border border-info/20 bg-info-50 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Banknote className="h-4 w-4 text-info" />
                <Label className="text-sm font-medium text-info">
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
                    type="text"
                    inputMode="decimal"
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
                  vuelto > 0 ? "text-success" : "text-muted-foreground"
                )}>
                  <div className="text-xs text-muted-foreground">Vuelto</div>
                  <div className="text-xl font-bold">{formatPrice(vuelto)}</div>
                </div>
              </div>

              {montoRecibido !== "" && montoRecibido < total && (
                <p className="text-xs text-destructive">
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
          {pendienteRequiereCliente && (
            <p className="text-xs text-destructive text-center">
              Seleccioná un cliente para dejar saldo pendiente / fiar
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={loading}>
              Cancelar
            </Button>
            <Button
              className="flex-1 h-12 text-base font-semibold"
              onClick={handleSubmit}
              disabled={loading || pendienteRequiereCliente}
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
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
