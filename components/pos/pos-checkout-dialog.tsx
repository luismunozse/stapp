"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import { useSession } from "next-auth/react"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  CreditCard,
  Loader2,
  Banknote,
  ArrowDownUp,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { parseMoneyInput } from "@/lib/parse-money"
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
  const { data: session } = useSession()
  const [loading, setLoading] = useState(false)
  const [pagosLines, setPagosLines] = useState<PagoLineItem[]>([createPagoLine(0)])
  const [observaciones, setObservaciones] = useState("")
  const [saldoCuenta, setSaldoCuenta] = useState(0)
  const [pagoParcial, setPagoParcial] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState<string>("")
  const [recargosMetodo, setRecargosMetodo] = useState<Record<string, number>>({})
  const [vendedores, setVendedores] = useState<Array<{ id: string; nombre: string }>>([])
  const [vendedorId, setVendedorId] = useState<string>("")

  // Item 7: line items breakdown toggle
  const [showItems, setShowItems] = useState(false)

  // Cash change calculation. El texto crudo vive en su propio estado para que
  // la coma decimal es-AR no se borre en cada tecleo (ver montoRecibido más
  // abajo); parseMoneyInput normaliza "1.500,50" y similares, y devuelve NaN
  // para vacío/inválido — que acá se colapsa al mismo estado "" que antes.
  const [montoRecibidoTexto, setMontoRecibidoTexto] = useState("")
  const montoRecibidoParsed = parseMoneyInput(montoRecibidoTexto)
  const montoRecibido: number | "" = Number.isNaN(montoRecibidoParsed) ? "" : montoRecibidoParsed

  // Método que fija el precio: el pago de mayor monto (empate => primero).
  // Replicado aquí para no importar @/lib/recargos (usa supabaseAdmin, server-only).
  function resolveMetodoCondicion(
    pagos: Array<{ metodo: string; monto: number }>,
    fallback: string
  ): string {
    if (!pagos || pagos.length === 0) return fallback
    let elegido = pagos[0]
    for (const p of pagos) {
      if (p.monto > elegido.monto) elegido = p
    }
    return elegido.metodo
  }

  // roundCash = all payment lines are EFECTIVO (mirrors backend isCash logic)
  const isCashOnly = pagosLines.length === 1 && pagosLines[0].metodo === "EFECTIVO"
  const allCash = pagosLines.length > 0 && pagosLines.every((p) => p.metodo === "EFECTIVO")
  const t = computeVentaTotals(items, descuentoGlobal, fiscal, allCash)
  const total = t.total

  // Total efectivo: precio base × factor del método-condición
  const metodoCondicionActual = resolveMetodoCondicion(
    pagosLines.map((p) => ({ metodo: p.metodo, monto: p.monto })),
    pagosLines[0]?.metodo ?? "EFECTIVO"
  )
  const porcentajeRecargo = recargosMetodo[metodoCondicionActual] ?? 0
  const factorEfectivo = 1 + porcentajeRecargo / 100
  const totalEfectivo = Math.round(total * factorEfectivo * 100) / 100

  const vuelto = useMemo(() => {
    if (!isCashOnly || montoRecibido === "") return 0
    return Math.max(0, montoRecibido - totalEfectivo)
  }, [isCashOnly, montoRecibido, totalEfectivo])

  // Reset the form only when the dialog actually opens. Keying this on `total`
  // instead used to wipe `pagoParcial` whenever the total moved mid-checkout —
  // the fiscal config landing late, a global discount, or the cash-rounding flip
  // that follows switching payment method — so a sale the cashier had just marked
  // as fiado silently went out fully paid. Re-seeding the amount on a total change
  // is the next effect's job, and that one respects `pagoParcial`.
  const wasOpen = useRef(false)
  useEffect(() => {
    const justOpened = open && !wasOpen.current
    wasOpen.current = open
    if (!justOpened) return
    setPagosLines([createPagoLine(totalEfectivo)])
    setMontoRecibidoTexto("")
    setObservaciones("")
    setPagoParcial(false)
    setIdempotencyKey(crypto.randomUUID())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Re-seed the single payment line's monto when the effective total changes due to
  // a method switch — only for the common non-partial single-line case.
  // Avoids a "no coincide" error when the cashier changes method mid-checkout.
  useEffect(() => {
    if (!pagoParcial && pagosLines.length === 1 && totalEfectivo > 0) {
      setPagosLines((prev) => {
        if (prev.length !== 1) return prev
        const line = prev[0]
        if (line.monto === totalEfectivo) return prev
        return [{ ...line, monto: totalEfectivo }]
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalEfectivo])

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

  // Cargar mapa de recargos por método al abrir el diálogo
  useEffect(() => {
    if (!open) return
    fetch("/api/configuracion/recargos-metodo")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data?.recargos) return
        const map: Record<string, number> = {}
        for (const { metodo, porcentaje } of data.recargos) {
          if (porcentaje > 0) map[metodo] = porcentaje
        }
        setRecargosMetodo(map)
      })
      .catch(() => setRecargosMetodo({}))
  }, [open])

  // Cargar lista de vendedores y preseleccionar el usuario de sesión al abrir
  useEffect(() => {
    if (!open) return
    setVendedorId(session?.user?.id ?? "")
    fetch("/api/operadores?rol=VENDEDOR")
      .then((r) => r.ok ? r.json() : [])
      .then((data: Array<{ id: string; nombre: string }>) => setVendedores(data))
      .catch(() => setVendedores([]))
  }, [open, session?.user?.id])

  // Re-entrancy guard: un ref (no el state `loading`) porque el callback
  // puede volver a dispararse antes de que React repinte con `loading` en
  // true — leer el state acá adentro vería el valor stale del render
  // anterior. El `finally` único de abajo cubre TODOS los retornos
  // tempranos (validaciones, stock insuficiente, error de red) para
  // `submittingRef`, así que no hace falta repetir su liberación en cada
  // `return`. `loading` es otra historia: las validaciones puramente
  // sincrónicas de más abajo lo liberan ANTES de mostrar el error (ver
  // ISSUE 3) para no dejar el botón diciendo "Procesando..." mientras la
  // alerta, que no depende de nada async, sigue en pantalla. El guard de
  // reentrada sigue siendo `submittingRef`, no `loading`.
  const submittingRef = useRef(false)

  const handleSubmit = async () => {
    if (submittingRef.current) return
    submittingRef.current = true
    setLoading(true)
    try {
      // Validar contra el total efectivo (precio base × factor del método)
      const totalPagosBase = pagosLines.reduce((sum, p) => sum + (p.monto || 0), 0)

      // Sin pago parcial, los pagos deben coincidir con el total efectivo
      if (!pagoParcial && Math.abs(totalPagosBase - totalEfectivo) > 0.01) {
        // Validación 100% sincrónica: no hay nada async en vuelo, así que se
        // libera `loading` ANTES de esperar a que el cajero cierre la alerta
        // (si no, el botón queda diciendo "Procesando..." mientras la propia
        // alerta dice que hubo un error — contradictorio). `submittingRef`
        // sigue en true hasta el `return`, así que un segundo click durante
        // la alerta no reentra.
        setLoading(false)
        await showError(
          `El total de pagos (${formatPrice(totalPagosBase)}) no coincide con el total a cobrar (${formatPrice(totalEfectivo)}). Active "Pago parcial" para dejar saldo pendiente.`
        )
        return
      }
      // Con pago parcial, los pagos no pueden exceder el total efectivo
      if (pagoParcial && totalPagosBase > totalEfectivo + 0.01) {
        setLoading(false)
        await showError("El total de pagos no puede exceder el total de la venta")
        return
      }

      // Una venta con saldo pendiente requiere un cliente registrado
      const saldoPendiente = totalEfectivo - totalPagosBase
      if (pagoParcial && saldoPendiente > 0.01 && !cliente.id) {
        setLoading(false)
        await showError("Seleccioná un cliente para dejar saldo pendiente / fiar")
        return
      }

      // Validate cuenta corriente
      const pagoCC = pagosLines.find((p) => p.metodo === "CUENTA_CORRIENTE")
      if (pagoCC && pagoCC.monto > saldoCuenta) {
        setLoading(false)
        await showError(`Saldo insuficiente en cuenta corriente (${formatPrice(saldoCuenta)})`)
        return
      }
      if (pagoCC && !cliente.id) {
        setLoading(false)
        await showError("Seleccione un cliente registrado para usar cuenta corriente")
        return
      }

      // Validar selección de series para items serializados
      const itemSinSeries = items.find(
        (it) => it.trackeaSeries && it.serieIds.length !== it.cantidad
      )
      if (itemSinSeries) {
        setLoading(false)
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
          // scope=venta: validate against the sucursal/deposito the sale will
          // actually draw from (same resolution as the ventas write path),
          // not the aggregate/"todas" view an ADMIN might be looking at.
          const stockRes = await fetch("/api/inventario/check-stock?scope=venta", {
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
              // Igual que las seis validaciones sincrónicas de más arriba (ver
              // ISSUE 3): para cuando se llega acá, `fetchConTimeout` ya
              // resolvió y no queda nada async en vuelo, así que `loading` se
              // libera ANTES de esperar a que el cajero cierre la alerta. Sin
              // esto el botón seguía diciendo "Procesando..." con la alerta
              // de "Stock insuficiente" ya en pantalla — insuficiente stock al
              // cobrar es rutinario en este rubro, no un caso raro.
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

      const payload = buildVentaPayload({
        items,
        cliente,
        pagosLines,
        pagoParcial,
        observaciones,
        idempotencyKey,
        descuentoGlobal,
        ...(descuentoMotivo ? { descuentoMotivo } : {}),
        ...(vendedorId ? { vendedorId } : {}),
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
      submittingRef.current = false
      setLoading(false)
    }
  }

  // Whether the confirm button should be blocked due to missing client for pending balance
  const pendienteRequiereCliente = useMemo(() => {
    const totalPagosBase = pagosLines.reduce((sum, p) => sum + (p.monto || 0), 0)
    const saldoPendiente = totalEfectivo - totalPagosBase
    return pagoParcial && saldoPendiente > 0.01 && !cliente.id
  }, [pagoParcial, pagosLines, totalEfectivo, cliente.id])

  // Quick cash amounts
  const quickAmounts = useMemo(() => {
    if (!isCashOnly) return []
    const rounded = Math.ceil(totalEfectivo / 100) * 100
    const amounts = [totalEfectivo]
    if (rounded !== totalEfectivo) amounts.push(rounded)
    if (rounded + 500 <= totalEfectivo * 3) amounts.push(rounded + 500)
    if (rounded + 1000 <= totalEfectivo * 3) amounts.push(rounded + 1000)
    return [...new Set(amounts)]
  }, [totalEfectivo, isCashOnly])

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
            {/* Item 7: Collapsible line items breakdown */}
            <div className="mt-2 mb-1">
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowItems((v) => !v)}
              >
                {showItems ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {showItems ? "Ocultar" : "Ver"} productos
              </button>
              {showItems && (
                <div className="mt-1.5 max-h-48 overflow-y-auto space-y-1 rounded border bg-background/60 p-2">
                  {items.map((item) => {
                    const gross = item.precioUnitario * item.cantidad
                    const lineDesc =
                      item.tipoDescuento === "PORCENTAJE"
                        ? gross * ((item.porcentajeDescuento || 0) / 100)
                        : Math.min(item.descuento || 0, gross)
                    const lineNet = gross - lineDesc
                    return (
                      <div key={item.lineId} className="flex items-center justify-between text-xs gap-2">
                        <span className="truncate text-muted-foreground flex-1">{item.nombre} × {item.cantidad}</span>
                        <span className="font-medium shrink-0">{formatPrice(lineNet)}</span>
                      </div>
                    )
                  })}
                </div>
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
            <TotalRow label="Total contado" amount={formatPrice(total)} emphasis />
            {porcentajeRecargo > 0 && (
              <TotalRow
                label={`Total ${metodoCondicionActual.toLowerCase().replace("_", " ")} (+${porcentajeRecargo}%)`}
                amount={formatPrice(totalEfectivo)}
                emphasis
              />
            )}
          </div>

          {/* Quick action: fiar. The label says "cuenta corriente" because that is
              what the cashier calls a credit sale; the CUENTA_CORRIENTE payment
              method below spends existing credit instead, so it cannot serve here. */}
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
              <div className="flex flex-col gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!cliente.id}
                  className="h-7 text-xs text-warning border-warning/40 hover:bg-warning-50"
                  onClick={() => {
                    setPagoParcial(true)
                    setPagosLines([createPagoLine(0)])
                  }}
                >
                  Fiar / Cuenta corriente
                </Button>
                {!cliente.id && (
                  <span className="text-xs text-muted-foreground">
                    Seleccioná un cliente para fiar
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Payment method - hidden when fully deferred */}
          {!(pagoParcial && pagosLines.length === 1 && (pagosLines[0].monto || 0) === 0) ? (
          <div className="space-y-3">
            <Label className="text-sm font-medium">Método de pago</Label>
            <MultiPagoInput
              montoPendiente={totalEfectivo}
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
              <p className="text-2xl font-bold text-destructive">{formatPrice(totalEfectivo)}</p>
              <p className="text-xs text-muted-foreground">
                El cobro se registra después desde el detalle de la venta
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => {
                  setPagosLines([createPagoLine(totalEfectivo)])
                }}
              >
                Quiero registrar un pago parcial
              </Button>
            </div>
          )}

          {/* Partial payment summary */}
          {pagoParcial && (() => {
            const totalPagosBase = pagosLines.reduce((sum, p) => sum + (p.monto || 0), 0)
            const pendiente = totalEfectivo - totalPagosBase
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
                    onClick={() => setMontoRecibidoTexto(String(amount))}
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
                    value={montoRecibidoTexto}
                    onChange={(e) => setMontoRecibidoTexto(e.target.value)}
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

              {montoRecibido !== "" && montoRecibido < totalEfectivo && (
                <p className="text-xs text-destructive">
                  Faltan {formatPrice(totalEfectivo - montoRecibido)}
                </p>
              )}
            </div>
          )}

          {/* Vendedor */}
          {vendedores.length > 0 && (
            <div>
              <Label htmlFor="vendedorId" className="text-xs">Vendedor</Label>
              <Select
                value={vendedorId || "NONE"}
                onValueChange={(v) => setVendedorId(v === "NONE" ? "" : v)}
              >
                <SelectTrigger id="vendedorId" className="mt-1">
                  <SelectValue placeholder="Seleccionar vendedor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Sin asignar</SelectItem>
                  {vendedores.map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
