"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Trash2,
  Minus,
  Plus,
  User,
  Search,
  ShoppingCart,
  CreditCard,
  Pause,
  RotateCcw,
  X,
  ChevronDown,
  ChevronUp,
  Shield,
  WifiOff,
  Pencil,
  Store,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useCurrency } from "@/contexts/currency-context"
import { autoSelectSeries, computeVentaTotals } from "./pos-types"
import type { PosCartItem, PosCliente, SerieDisponible, DescuentoConfig, TipoDescuento, FiscalConfig } from "./pos-types"
import { EmptyState } from "@/components/ui/empty-state"
import { TotalRow } from "@/components/pos/total-row"

interface PosCartProps {
  items: PosCartItem[]
  cliente: PosCliente
  onUpdateQuantity: (lineId: string, delta: number) => void
  onRemoveItem: (lineId: string) => void
  onSetGarantia: (lineId: string, dias: number) => void
  onSetSerieIds: (lineId: string, serieIds: string[]) => void
  onSetCliente: (cliente: PosCliente) => void
  onCheckout: () => void
  /** When set, the checkout button is disabled and shows this reason (e.g. offline). */
  checkoutDisabledReason?: string
  onHoldSale: () => void
  onRecallSale: () => void
  onClearCart: () => void
  heldCount: number
  showClienteSearch: boolean
  onToggleClienteSearch: () => void
  descuentoGlobal: DescuentoConfig | null
  descuentoMotivo: string
  onSetItemDescuento: (lineId: string, d: { tipo: TipoDescuento; valor: number }) => void
  onSetDescuentoGlobal: (d: DescuentoConfig | null) => void
  onSetDescuentoMotivo: (m: string) => void
  onSetPrecio: (lineId: string, precio: number) => void
  fiscal?: FiscalConfig | null
  /** Sucursal the sale will actually draw stock from, when resolved (see pos-terminal.tsx). */
  ventaSucursalNombre?: string | null
  /**
   * True when the sale spans the whole org despite a concrete sucursal being
   * selected — see derivarAvisoAlcanceOrg in lib/sucursal.ts. Mutually
   * exclusive with a resolved `ventaSucursalNombre`: in this state there is no
   * single sucursal to name.
   */
  ventaAlcanceOrg?: boolean
}

interface ClienteResult {
  id: string
  nombre: string
  telefono: string
}

export function PosCart({
  items,
  cliente,
  onUpdateQuantity,
  onRemoveItem,
  onSetGarantia,
  onSetSerieIds,
  onSetCliente,
  onCheckout,
  checkoutDisabledReason,
  onHoldSale,
  onRecallSale,
  onClearCart,
  heldCount,
  showClienteSearch,
  onToggleClienteSearch,
  descuentoGlobal,
  descuentoMotivo,
  onSetItemDescuento,
  onSetDescuentoGlobal,
  onSetDescuentoMotivo,
  onSetPrecio,
  fiscal,
  ventaSucursalNombre = null,
  ventaAlcanceOrg = false,
}: PosCartProps) {
  const { formatPrice } = useCurrency()
  // No gating here on purpose: whether this indicator disambiguates anything
  // depends on the httpOnly sucursal cookie and the org's sucursal count, neither
  // of which the browser can see. The server sends a name only when it is worth
  // showing (resolverIndicadorVenta in lib/sucursal.ts), so a name is the signal.
  const showVentaSucursal = !!ventaSucursalNombre
  const [clienteQuery, setClienteQuery] = useState("")
  const [clienteResults, setClienteResults] = useState<ClienteResult[]>([])
  const [clienteLoading, setClienteLoading] = useState(false)
  const [editingQtyId, setEditingQtyId] = useState<string | null>(null)
  const [editingQtyValue, setEditingQtyValue] = useState("")
  const [expandedItem, setExpandedItem] = useState<string | null>(null)
  const [garantiaDraft, setGarantiaDraft] = useState<string>("")
  const [precioDraft, setPrecioDraft] = useState<string>("")
  const [seriesDisp, setSeriesDisp] = useState<Record<string, SerieDisponible[]>>({})
  const [seriesLoading, setSeriesLoading] = useState<string | null>(null)
  // Per-item discount drafts (tipo toggle + value input)
  const [itemDescTipo, setItemDescTipo] = useState<Record<string, TipoDescuento>>({})
  const clienteInputRef = useRef<HTMLInputElement>(null)

  // Global discount local draft state
  const [globalDescTipo, setGlobalDescTipo] = useState<TipoDescuento>(descuentoGlobal?.tipo ?? "PORCENTAJE")
  const [globalDescValor, setGlobalDescValor] = useState<string>(descuentoGlobal ? String(descuentoGlobal.valor) : "")

  // Último valor que ESTE componente subió al padre (null incluido). Se usa
  // para distinguir un cambio externo real de `descuentoGlobal` (venta
  // completada, vaciar carrito, F2) de la vuelta como prop de algo que el
  // propio cajero acaba de tipear.
  // "Recuperar apartado" NO es un caso de restaurar el descuento del
  // apartado: `recallSale` pisa `descuentoGlobal` a `null` sin condición y
  // `HeldSale` ni siquiera lo persiste, así que llega acá como un reset más
  // (mismo camino que vaciar carrito), no como un valor externo distinto.
  const lastEmittedDescuentoRef = useRef<DescuentoConfig | null>(descuentoGlobal)

  const emitDescuentoGlobal = (d: DescuentoConfig | null) => {
    lastEmittedDescuentoRef.current = d
    onSetDescuentoGlobal(d)
  }

  // Resincroniza el draft cuando el padre cambia `descuentoGlobal` desde
  // afuera (venta completada, vaciar carrito): sin esto, el toggle %/$ y el
  // valor quedaban mostrando el descuento del cliente anterior hasta que
  // alguien tocaba el campo, y ahí reaplicaba ese descuento viejo sobre la
  // venta nueva.
  // No alcanza con comparar el prop entrante contra el draft actual: cada
  // tecla que el cajero tipea sube un `descuentoGlobal` NUEVO (por ejemplo
  // `null` al borrar el dígito para reemplazarlo) y ese valor sí es un
  // cambio real, así que el efecto se reejecutaría y pisaría lo que el
  // cajero recién tipeó antes de que termine de escribir el siguiente
  // carácter. Por eso comparamos por REFERENCIA con lo último que ESTE
  // componente emitió: `onSetDescuentoGlobal` baja exactamente el mismo
  // objeto que subimos (el padre lo guarda en un `useState` y lo devuelve
  // tal cual, sin clonarlo), así que la identidad ya detecta cualquier eco
  // genuino. No se compara tipo/valor a propósito: eso ensancharía "eco" a
  // cualquier escritura externa que coincida en valor con la última emitida
  // (hoy inalcanzable porque todo escritor externo manda `null`, pero sería
  // una trampa para la próxima feature que setee un descuento no nulo desde
  // afuera) y, en ese caso, el efecto se saltearía tanto la resincronización
  // como la actualización de esta ref.
  useEffect(() => {
    const last = lastEmittedDescuentoRef.current
    const isEcho = last === descuentoGlobal
    if (isEcho) return
    lastEmittedDescuentoRef.current = descuentoGlobal
    setGlobalDescTipo(descuentoGlobal?.tipo ?? "PORCENTAJE")
    setGlobalDescValor(descuentoGlobal ? String(descuentoGlobal.valor) : "")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descuentoGlobal?.tipo, descuentoGlobal?.valor])

  // Focus client search when toggled
  useEffect(() => {
    if (showClienteSearch) {
      setTimeout(() => clienteInputRef.current?.focus(), 100)
    }
  }, [showClienteSearch])

  // Client search
  useEffect(() => {
    if (!clienteQuery.trim()) {
      setClienteResults([])
      return
    }
    const timer = setTimeout(async () => {
      setClienteLoading(true)
      try {
        const res = await fetch(`/api/clientes?search=${encodeURIComponent(clienteQuery)}&limit=8`)
        const data = await res.json()
        const items = data.data ?? (Array.isArray(data) ? data : [])
        setClienteResults(items)
      } catch {
        setClienteResults([])
      } finally {
        setClienteLoading(false)
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [clienteQuery])

  // Cargar series DISPONIBLE cuando se expande una línea serializada.
  useEffect(() => {
    if (!expandedItem) return
    const item = items.find((i) => i.lineId === expandedItem)
    if (!item || !item.trackeaSeries || !item.inventarioId) return
    const cached = seriesDisp[item.lineId]
    if (cached) {
      // Lista ya cargada: re-autoseleccionar FIFO si la selección quedó vacía
      // (p.ej. tras cambiar la cantidad, que limpia serieIds).
      if (item.serieIds.length === 0 && item.cantidad > 0) {
        onSetSerieIds(item.lineId, autoSelectSeries(cached, item.cantidad))
      }
      return
    }

    let cancelled = false
    setSeriesLoading(item.lineId)
    fetch(`/api/inventario/${item.inventarioId}/series?estado=DISPONIBLE&limit=500&order=asc`)
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((data) => {
        if (cancelled) return
        const list: SerieDisponible[] = (data.data ?? []).map((s: any) => ({
          id: s.id, numeroSerie: s.numero_serie,
        }))
        setSeriesDisp((prev) => ({ ...prev, [item.lineId]: list }))
        if (item.serieIds.length === 0) {
          onSetSerieIds(item.lineId, autoSelectSeries(list, item.cantidad))
        }
      })
      .catch(() => { if (!cancelled) setSeriesDisp((prev) => ({ ...prev, [item.lineId]: [] })) })
      .finally(() => { if (!cancelled) setSeriesLoading(null) })
    return () => { cancelled = true }
  }, [expandedItem, items, seriesDisp, onSetSerieIds])

  const selectCliente = (c: ClienteResult) => {
    onSetCliente({ id: c.id, nombre: c.nombre, telefono: c.telefono })
    setClienteQuery("")
    setClienteResults([])
    onToggleClienteSearch()
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="p-3 border-b space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-primary" />
            <h2 className="font-semibold text-lg">Carrito</h2>
            {items.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {items.reduce((sum, i) => sum + i.cantidad, 0)}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            {items.length > 0 && (
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={onClearCart} title="Vaciar carrito">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Selling-from indicator — only when "todas las sucursales" would otherwise hide it */}
        {showVentaSucursal && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Store className="h-3.5 w-3.5 shrink-0" />
            Vendiendo desde: <span className="font-medium text-foreground">{ventaSucursalNombre}</span>
          </p>
        )}

        {/* Alcance ensanchado: el selector muestra una sucursal, pero la venta
            toma stock de toda la organización. Sin esto, la única explicación
            en pantalla sería el chip del selector, que dice lo contrario. */}
        {ventaAlcanceOrg && (
          <p className="flex items-start gap-1.5 text-xs text-warning">
            <Store className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              Vendiendo desde <span className="font-medium">todas las sucursales</span>: la
              sucursal seleccionada no tiene depósito principal.
            </span>
          </p>
        )}

        {/* Cliente */}
        <div className="flex items-center gap-2">
          <Button
            variant={cliente.id ? "secondary" : "outline"}
            size="sm"
            className="flex-1 justify-start h-9 text-sm"
            onClick={onToggleClienteSearch}
          >
            <User className="h-3.5 w-3.5 mr-1.5 shrink-0" />
            {cliente.nombre ? (
              <span className="truncate">{cliente.nombre}</span>
            ) : (
              <span className="text-muted-foreground">Cliente (F7)</span>
            )}
          </Button>
          {cliente.id && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => onSetCliente({ id: null, nombre: "", telefono: "" })}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {/* Client search dropdown */}
        {showClienteSearch && (
          <div className="space-y-2 p-2 rounded-lg border bg-muted/30">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={clienteInputRef}
                value={clienteQuery}
                onChange={(e) => setClienteQuery(e.target.value)}
                placeholder="Buscar cliente..."
                className="pl-8 h-8 text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Escape") onToggleClienteSearch()
                  if (e.key === "Enter" && clienteResults.length === 1) selectCliente(clienteResults[0])
                }}
              />
            </div>
            {/* Manual entry */}
            {!clienteQuery.trim() && (
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="Nombre"
                  className="h-8 text-sm"
                  value={cliente.nombre && !cliente.id ? cliente.nombre : ""}
                  onChange={(e) => onSetCliente({ id: null, nombre: e.target.value, telefono: cliente.telefono })}
                />
                <Input
                  placeholder="Teléfono"
                  className="h-8 text-sm"
                  value={cliente.telefono && !cliente.id ? cliente.telefono : ""}
                  onChange={(e) => onSetCliente({ id: null, nombre: cliente.nombre, telefono: e.target.value })}
                />
              </div>
            )}
            {clienteResults.length > 0 && (
              <div className="max-h-32 overflow-y-auto rounded border bg-background">
                {clienteResults.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex justify-between"
                    onClick={() => selectCliente(c)}
                  >
                    <span className="font-medium truncate">{c.nombre}</span>
                    <span className="text-xs text-muted-foreground shrink-0 ml-2">{c.telefono}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Cart items */}
      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <EmptyState
            icon={ShoppingCart}
            title="Carrito vacío"
            description="Buscá o escaneá un producto para empezar"
          />
        ) : (
          <div className="divide-y">
            {items.map((item) => {
              const isExpanded = expandedItem === item.lineId
              return (
                <div key={item.lineId} className="px-3 py-2">
                  <div className="flex items-start gap-2">
                    {/* Product info */}
                    <button
                      type="button"
                      className="flex-1 min-w-0 text-left"
                      onClick={() => {
                        if (isExpanded) {
                          setExpandedItem(null)
                        } else {
                          setExpandedItem(item.lineId)
                          setGarantiaDraft(String(item.diasGarantia))
                          setPrecioDraft(String(item.precioUnitario))
                        }
                      }}
                    >
                      <div className="flex items-center gap-1">
                        <span className="text-sm font-medium truncate">{item.nombre}</span>
                        {item.diasGarantia > 0 && (
                          <Shield className="h-3 w-3 text-success shrink-0" />
                        )}
                        {isExpanded ? (
                          <ChevronUp className="h-3 w-3 text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{formatPrice(item.precioUnitario)} c/u</span>
                        {item.codigo && <span className="font-mono">{item.codigo}</span>}
                        {item.stockDisponible <= 3 && (
                          <span className="text-destructive">Stock: {item.stockDisponible}</span>
                        )}
                      </div>
                    </button>

                    {/* Quantity controls - tap span to edit, +/- for increments */}
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 sm:h-7 sm:w-7 active:scale-90 active:bg-accent/60 transition-transform"
                        onClick={() => onUpdateQuantity(item.lineId, -1)}
                      >
                        <Minus className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
                      </Button>
                      {editingQtyId === item.lineId ? (
                        <input
                          type="number"
                          className="w-10 text-center text-sm font-semibold tabular-nums border rounded h-7 focus:outline-none focus:ring-1 focus:ring-primary bg-background"
                          value={editingQtyValue}
                          autoFocus
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => setEditingQtyValue(e.target.value)}
                          onBlur={() => {
                            const parsed = parseInt(editingQtyValue, 10)
                            if (!isNaN(parsed) && parsed > 0) {
                              const maxQty = item.inventarioId ? item.stockDisponible : 9999
                              const clamped = Math.min(parsed, maxQty)
                              const delta = clamped - item.cantidad
                              if (delta !== 0) onUpdateQuantity(item.lineId, delta)
                            }
                            setEditingQtyId(null)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur()
                            if (e.key === "Escape") setEditingQtyId(null)
                          }}
                          min={1}
                          max={item.inventarioId ? item.stockDisponible : 9999}
                        />
                      ) : (
                        <button
                          type="button"
                          className="w-8 text-center text-sm font-semibold tabular-nums cursor-pointer hover:bg-muted rounded transition-colors h-7 flex items-center justify-center"
                          onClick={() => {
                            setEditingQtyId(item.lineId)
                            setEditingQtyValue(String(item.cantidad))
                          }}
                          title="Tap to edit quantity"
                        >
                          {item.cantidad}
                        </button>
                      )}
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 sm:h-7 sm:w-7 active:scale-90 active:bg-accent/60 transition-transform"
                        onClick={() => onUpdateQuantity(item.lineId, 1)}
                        disabled={item.inventarioId !== null && item.cantidad >= item.stockDisponible}
                      >
                        <Plus className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
                      </Button>
                    </div>

                    {/* Line total */}
                    <div className="text-right shrink-0 w-20">
                      {(() => {
                        const gross = item.precioUnitario * item.cantidad
                        const lineDesc =
                          item.tipoDescuento === "PORCENTAJE"
                            ? gross * ((item.porcentajeDescuento || 0) / 100)
                            : Math.min(item.descuento || 0, gross)
                        const net = gross - lineDesc
                        return lineDesc > 0 ? (
                          <>
                            <div className="text-xs text-muted-foreground line-through">{formatPrice(gross)}</div>
                            <span className="text-sm font-semibold text-success">{formatPrice(net)}</span>
                          </>
                        ) : (
                          <span className="text-sm font-semibold">{formatPrice(gross)}</span>
                        )
                      })()}
                    </div>

                    {/* Edit price / warranty / discount */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 sm:h-7 px-2 gap-1 text-xs text-muted-foreground shrink-0"
                      onClick={() => {
                        if (isExpanded) {
                          setExpandedItem(null)
                        } else {
                          setExpandedItem(item.lineId)
                          setGarantiaDraft(String(item.diasGarantia))
                          setPrecioDraft(String(item.precioUnitario))
                        }
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Editar</span>
                    </Button>

                    {/* Remove */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 sm:h-7 sm:w-7 text-destructive shrink-0"
                      onClick={() => onRemoveItem(item.lineId)}
                    >
                      <Trash2 className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                    </Button>
                  </div>

                  {/* Expanded options */}
                  {isExpanded && (
                    <div className="mt-2 pl-1 flex flex-col gap-2 text-xs">
                      <label className="flex items-center gap-1.5">
                        <Shield className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">Garantía (días):</span>
                        <Input
                          type="number"
                          min={0}
                          value={garantiaDraft}
                          onChange={(e) => {
                            setGarantiaDraft(e.target.value)
                            onSetGarantia(item.lineId, parseInt(e.target.value, 10) || 0)
                          }}
                          className="h-7 w-16 text-xs text-center"
                        />
                      </label>

                      {/* Per-line unit price override */}
                      <label className="flex items-center gap-1.5">
                        <span className="text-muted-foreground">Precio unit.:</span>
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={precioDraft}
                          onChange={(e) => {
                            setPrecioDraft(e.target.value)
                            const parsed = parseFloat(e.target.value)
                            if (parsed > 0) onSetPrecio(item.lineId, parsed)
                          }}
                          className="h-7 w-24 text-xs text-center"
                        />
                      </label>

                      {/* Per-line discount */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground shrink-0">Descuento:</span>
                        <div className="flex items-center rounded-md border overflow-hidden h-7">
                          {(["PORCENTAJE", "MONTO"] as TipoDescuento[]).map((t) => {
                            const currentTipo = itemDescTipo[item.lineId] ?? (item.tipoDescuento ?? "PORCENTAJE")
                            return (
                              <button
                                key={t}
                                type="button"
                                onClick={() => {
                                  setItemDescTipo((prev) => ({ ...prev, [item.lineId]: t }))
                                  const val = t === "PORCENTAJE" ? (item.porcentajeDescuento ?? 0) : (item.descuento ?? 0)
                                  onSetItemDescuento(item.lineId, { tipo: t, valor: val })
                                }}
                                className={cn(
                                  "px-2 h-full text-[10px] font-medium transition-colors",
                                  currentTipo === t
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-background text-muted-foreground hover:bg-muted"
                                )}
                              >
                                {t === "PORCENTAJE" ? "%" : "$"}
                              </button>
                            )
                          })}
                        </div>
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={(() => {
                            const tipo = itemDescTipo[item.lineId] ?? (item.tipoDescuento ?? "PORCENTAJE")
                            return tipo === "PORCENTAJE" ? (item.porcentajeDescuento ?? 0) : (item.descuento ?? 0)
                          })()}
                          onChange={(e) => {
                            const tipo = itemDescTipo[item.lineId] ?? (item.tipoDescuento ?? "PORCENTAJE")
                            const val = parseFloat(e.target.value) || 0
                            onSetItemDescuento(item.lineId, { tipo, valor: val })
                          }}
                          className="h-7 w-20 text-xs text-center"
                          placeholder="0"
                        />
                      </div>

                      {item.trackeaSeries && (
                        <div className="rounded border bg-muted/30 p-2 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground font-medium">
                              Series ({item.serieIds.length}/{item.cantidad})
                            </span>
                            {item.serieIds.length !== item.cantidad && (
                              <span className="text-destructive">
                                Seleccioná {item.cantidad}
                              </span>
                            )}
                          </div>
                          {seriesLoading === item.lineId ? (
                            <span className="text-muted-foreground">Cargando series…</span>
                          ) : (
                            <div className="max-h-40 overflow-y-auto grid grid-cols-2 gap-1">
                              {(seriesDisp[item.lineId] ?? []).map((s) => {
                                const checked = item.serieIds.includes(s.id)
                                return (
                                  <label
                                    key={s.id}
                                    className="flex items-center gap-2 cursor-pointer min-h-[40px] px-2 rounded hover:bg-muted/50 transition-colors"
                                  >
                                    <input
                                      type="checkbox"
                                      className="h-4 w-4 rounded shrink-0"
                                      checked={checked}
                                      onChange={() => {
                                        if (checked) {
                                          onSetSerieIds(item.lineId, item.serieIds.filter((id) => id !== s.id))
                                        } else if (item.serieIds.length < item.cantidad) {
                                          onSetSerieIds(item.lineId, [...item.serieIds, s.id])
                                        }
                                      }}
                                    />
                                    <span className="font-mono text-xs truncate">{s.numeroSerie}</span>
                                  </label>
                                )
                              })}
                              {(seriesDisp[item.lineId] ?? []).length === 0 && (
                                <span className="text-destructive col-span-2 text-xs px-2 py-2">Sin series disponibles</span>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer: Totals + Actions */}
      <div className="border-t bg-muted/30 shrink-0">
        {/* Global discount control */}
        {items.length > 0 && (
          <div className="px-4 pt-3 space-y-1.5">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-muted-foreground shrink-0">Descuento global:</span>
              <div className="flex items-center rounded-md border overflow-hidden h-7">
                {(["PORCENTAJE", "MONTO"] as TipoDescuento[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setGlobalDescTipo(t)
                      const val = parseFloat(globalDescValor) || 0
                      if (val > 0) emitDescuentoGlobal({ tipo: t, valor: val })
                    }}
                    className={cn(
                      "px-2 h-full text-[10px] font-medium transition-colors",
                      globalDescTipo === t
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {t === "PORCENTAJE" ? "%" : "$"}
                  </button>
                ))}
              </div>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={globalDescValor}
                onChange={(e) => {
                  const raw = e.target.value
                  setGlobalDescValor(raw)
                  const val = parseFloat(raw) || 0
                  if (val > 0) {
                    emitDescuentoGlobal({ tipo: globalDescTipo, valor: val })
                  } else {
                    emitDescuentoGlobal(null)
                  }
                }}
                className="h-7 w-20 text-xs text-center"
                placeholder="0"
              />
            </div>
            <Input
              value={descuentoMotivo}
              onChange={(e) => onSetDescuentoMotivo(e.target.value)}
              placeholder="Motivo del descuento (opcional)"
              className="h-7 text-xs"
            />
          </div>
        )}

        {/* Totals */}
        {items.length > 0 && (
          <div className="px-4 pt-2 space-y-1">
            {(() => {
              const t = computeVentaTotals(items, descuentoGlobal, fiscal)
              return (
                <>
                  <TotalRow
                    label={`Subtotal (${items.reduce((s, i) => s + i.cantidad, 0)} items)`}
                    amount={formatPrice(t.subtotal)}
                  />
                  {t.descuentoTotal > 0 && (
                    <TotalRow
                      label="Descuento"
                      amount={`- ${formatPrice(t.descuentoTotal)}`}
                      tone="success"
                    />
                  )}
                  {t.iva > 0 && (
                    <>
                      <TotalRow
                        label="Neto"
                        amount={formatPrice(t.neto)}
                      />
                      <TotalRow
                        label={`IVA (${fiscal?.tasa ?? 0}%)`}
                        amount={formatPrice(t.iva)}
                      />
                    </>
                  )}
                  <TotalRow
                    label="TOTAL"
                    amount={formatPrice(t.total)}
                    emphasis
                  />
                </>
              )
            })()}
          </div>
        )}

        {/* Action buttons */}
        <div className="p-3 space-y-2">
          <Button
            className="w-full h-12 text-lg font-semibold"
            disabled={items.length === 0 || !!checkoutDisabledReason}
            onClick={onCheckout}
            title={checkoutDisabledReason}
          >
            <CreditCard className="mr-2 h-5 w-5" />
            Cobrar (F8)
          </Button>
          {checkoutDisabledReason && (
            <p className="flex items-center justify-center gap-1.5 text-xs font-medium text-warning-700 dark:text-warning">
              <WifiOff className="h-3.5 w-3.5 shrink-0" />
              {checkoutDisabledReason}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={items.length === 0}
              onClick={onHoldSale}
              className="h-9"
            >
              <Pause className="mr-1.5 h-3.5 w-3.5" />
              Apartar (F5)
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onRecallSale}
              className={cn("h-9", heldCount > 0 && "border-warning text-warning")}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Recuperar (F6)
              {heldCount > 0 && (
                <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">
                  {heldCount}
                </Badge>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
