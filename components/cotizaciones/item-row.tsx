"use client"

import { useState, useEffect, useRef } from "react"
import { Input } from "@/components/ui/input"
import { parseMoneyInput } from "@/lib/parse-money"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Trash2, Percent, DollarSign, Package, X } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import { useModal } from "@/contexts/modal-context"

const UNIDADES = [
  { value: "Unidad", label: "Unidad" },
  { value: "Hora", label: "Hora" },
  { value: "Servicio", label: "Servicio" },
  { value: "Pieza", label: "Pieza" },
  { value: "Kit", label: "Kit" },
  { value: "Metro", label: "Metro" },
]

interface ItemRowProps {
  item: {
    descripcion: string
    cantidad: number
    precioUnitario: number
    costoUnitario?: number | null
    unidad?: string
    descuentoTipo?: string
    descuentoValor?: number
    inventarioId?: string | null
    servicioId?: string | null
    tipoRepuesto?: string
    precioCompra?: number | null
  }
  index: number
  onUpdate: (index: number, field: string, value: string | number | null) => void
  onRemove: (index: number) => void
  disabled?: boolean
  showTipoRepuesto?: boolean
}

const TIPO_REPUESTO_OPTIONS = [
  { value: "NO_APLICA", label: "No aplica" },
  { value: "ORIGINAL", label: "Original" },
  { value: "ALTERNATIVO", label: "Alternativo" },
  { value: "RECICLADO", label: "Reciclado" },
]

export function calcItemNeto(item: { cantidad: number; precioUnitario: number; descuentoTipo?: string; descuentoValor?: number }) {
  const bruto = item.cantidad * item.precioUnitario
  const dv = item.descuentoValor || 0
  if (dv <= 0) return bruto
  if (item.descuentoTipo === "fijo") return Math.max(0, bruto - dv)
  return Math.max(0, bruto * (1 - dv / 100))
}

export function ItemRow({ item, index, onUpdate, onRemove, disabled, showTipoRepuesto }: ItemRowProps) {
  const { formatPrice } = useCurrency()
  const { confirm } = useModal()
  const bruto = item.cantidad * item.precioUnitario
  const neto = calcItemNeto(item)
  const [invSearch, setInvSearch] = useState("")
  const [invResults, setInvResults] = useState<any[]>([])
  const [showInvSearch, setShowInvSearch] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

  // Local string state for numeric fields so the user can clear & retype freely.
  // The numeric value pushed to onUpdate (and thus to totals) is unchanged.
  const [cantidadStr, setCantidadStr] = useState(item.cantidad ? String(item.cantidad) : "")
  const [precioStr, setPrecioStr] = useState(item.precioUnitario ? String(item.precioUnitario) : "")
  const [descuentoStr, setDescuentoStr] = useState(item.descuentoValor ? String(item.descuentoValor) : "")

  // Sync local strings when the prop changes from outside (e.g. selecting an
  // inventory item sets precioUnitario, or applying a template). Avoid clobbering
  // an in-progress edit when the parsed number already matches the prop.
  useEffect(() => {
    if ((parseInt(cantidadStr) || 0) !== (item.cantidad || 0)) {
      setCantidadStr(item.cantidad ? String(item.cantidad) : "")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.cantidad])
  useEffect(() => {
    if ((parseMoneyInput(precioStr) || 0) !== (item.precioUnitario || 0)) {
      setPrecioStr(item.precioUnitario ? String(item.precioUnitario) : "")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.precioUnitario])
  useEffect(() => {
    if ((parseMoneyInput(descuentoStr) || 0) !== (item.descuentoValor || 0)) {
      setDescuentoStr(item.descuentoValor ? String(item.descuentoValor) : "")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.descuentoValor])

  useEffect(() => {
    if (!invSearch || invSearch.length < 2) { setInvResults([]); return }
    const t = setTimeout(async () => {
      const q = encodeURIComponent(invSearch)
      // Los dos catalogos de lo que el taller vende: productos y servicios.
      // Fallan por separado: que el inventario no responda no debe esconder los servicios.
      const [productos, servicios] = await Promise.all([
        fetch(`/api/inventario/search?q=${q}&limit=5&includeZeroStock=true`)
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => []),
        fetch(`/api/servicios?buscar=${q}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ])
      setInvResults([
        ...(Array.isArray(productos) ? productos : []).map((p: any) => ({ ...p, tipo: "PRODUCTO" })),
        ...((servicios?.servicios ?? []) as any[]).slice(0, 5).map((sv: any) => ({ ...sv, tipo: "SERVICIO" })),
      ])
    }, 300)
    return () => clearTimeout(t)
  }, [invSearch])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowInvSearch(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  const selectInvItem = async (inv: any) => {
    const disponible = (Number(inv.stock) || 0) - (Number(inv.stockReservado) || 0)
    if (disponible <= 0) {
      const ok = await confirm({
        title: "Producto sin stock",
        description: `"${inv.nombre}" no tiene stock disponible. La cotización no reserva stock hasta que se aprueba. ¿Querés cotizarlo igual?`,
        confirmText: "Cotizar igual",
        cancelText: "Cancelar",
        variant: "warning",
      })
      if (!ok) return
    }
    onUpdate(index, "descripcion", inv.nombre)
    onUpdate(index, "precioUnitario", Number(inv.precioVenta))
    onUpdate(index, "inventarioId", inv.id)
    onUpdate(index, "precioCompra", Number(inv.precioCompra) || 0)
    setShowInvSearch(false)
    setInvSearch("")
    setInvResults([])
  }

  // Un servicio no tiene stock que chequear ni precio de compra que arrastrar:
  // el margen de la linea queda sin costo conocido, no con costo cero.
  const selectServicio = (srv: any) => {
    onUpdate(index, "descripcion", srv.nombre)
    onUpdate(index, "precioUnitario", Number(srv.precio) || 0)
    onUpdate(index, "unidad", "Servicio")
    onUpdate(index, "servicioId", srv.id)
    setShowInvSearch(false)
    setInvSearch("")
    setInvResults([])
  }

  const clearLink = () => {
    if (item.servicioId) {
      onUpdate(index, "servicioId", null)
      return
    }
    onUpdate(index, "inventarioId", null)
    onUpdate(index, "precioCompra", null)
  }

  const vinculado = !!item.inventarioId || !!item.servicioId
  const hasDiscount = (item.descuentoValor || 0) > 0
  const costoUnit = Number(item.precioCompra) || 0
  const costoTotal = costoUnit * (item.cantidad || 0)
  const margenPct = item.precioUnitario > 0 && costoUnit > 0
    ? Math.round(((item.precioUnitario - costoUnit) / item.precioUnitario) * 100)
    : null
  const showCostInfo = !!item.inventarioId && costoUnit > 0

  return (
    <>
      {/* Mobile Layout */}
      <div className="sm:hidden space-y-2 py-3 border-b">
        <div className="flex justify-between items-start gap-2">
          <div className="flex-1 relative" ref={showInvSearch ? searchRef : undefined}>
            {showInvSearch ? (
              <div>
                <Input
                  placeholder="Buscar producto o servicio..."
                  value={invSearch}
                  onChange={(e) => setInvSearch(e.target.value)}
                  autoFocus
                />
                {invResults.length > 0 && (
                  <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-md max-h-48 overflow-y-auto">
                    {invResults.map((inv) => {
                      if (inv.tipo === "SERVICIO") {
                        return (
                          <button key={`srv-${inv.id}`} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-accent" onClick={() => selectServicio(inv)}>
                            <div className="font-medium">{inv.nombre}</div>
                            <div className="text-xs text-muted-foreground">Servicio{inv.categoria ? ` · ${inv.categoria}` : ""}</div>
                            <div className="text-xs text-muted-foreground mt-0.5">Precio: {formatPrice(Number(inv.precio) || 0)}</div>
                          </button>
                        )
                      }
                      const pc = Number(inv.precioCompra) || 0
                      const pv = Number(inv.precioVenta) || 0
                      const mPct = pv > 0 && pc > 0 ? Math.round(((pv - pc) / pv) * 100) : null
                      const disp = (Number(inv.stock) || 0) - (Number(inv.stockReservado) || 0)
                      return (
                        <button key={inv.id} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-accent" onClick={() => selectInvItem(inv)}>
                          <div className="font-medium">{inv.nombre}</div>
                          <div className="text-xs text-muted-foreground">
                            {disp <= 0 ? (
                              <span className="text-destructive font-medium">Sin stock</span>
                            ) : (
                              <>Stock: {inv.stock}{inv.stockReservado > 0 ? ` (disp. ${disp})` : ""}</>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            Costo: {formatPrice(pc)} · Venta: {formatPrice(pv)}{mPct !== null ? ` · ${mPct}%` : ""}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            ) : (
              <Input
                placeholder="Descripción del item"
                value={item.descripcion}
                onChange={(e) => onUpdate(index, "descripcion", e.target.value)}
                disabled={disabled}
              />
            )}
          </div>
          <Button type="button" variant={vinculado ? "secondary" : "outline"} size="icon" className="h-8 w-8 shrink-0" onClick={() => vinculado ? clearLink() : setShowInvSearch(!showInvSearch)} disabled={disabled} title={vinculado ? "Desvincular del catálogo" : "Buscar producto o servicio"}>
            {vinculado ? <X className="h-3.5 w-3.5" /> : <Package className="h-3.5 w-3.5" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onRemove(index)}
            disabled={disabled}
            className="h-8 w-8 text-destructive hover:text-destructive shrink-0"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
        {showTipoRepuesto && (
          <div>
            <label className="text-xs text-muted-foreground">Tipo de repuesto</label>
            <Select
              value={item.tipoRepuesto || "NO_APLICA"}
              onValueChange={(v) => onUpdate(index, "tipoRepuesto", v)}
              disabled={disabled}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPO_REPUESTO_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label htmlFor={`item-cantidad-${index}`} className="text-xs text-muted-foreground">Cantidad</label>
            <Input
              id={`item-cantidad-${index}`}
              type="text"
              inputMode="numeric"
              min="1"
              placeholder="Cant."
              value={cantidadStr}
              onChange={(e) => { setCantidadStr(e.target.value); onUpdate(index, "cantidad", parseInt(e.target.value) || 0) }}
              disabled={disabled}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Unidad</label>
            <Select
              value={item.unidad || "Unidad"}
              onValueChange={(v) => onUpdate(index, "unidad", v)}
              disabled={disabled}
            >
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UNIDADES.map((u) => (
                  <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label htmlFor={`item-precio-${index}`} className="text-xs text-muted-foreground">Precio</label>
            <Input
              id={`item-precio-${index}`}
              type="text"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="Precio"
              value={precioStr}
              onChange={(e) => { setPrecioStr(e.target.value); onUpdate(index, "precioUnitario", parseMoneyInput(e.target.value) || 0) }}
              disabled={disabled}
            />
          </div>
        </div>
        {!item.inventarioId && (
          <div>
            <label className="text-xs text-muted-foreground">Costo unitario (opcional, para margen)</label>
            <Input
              type="text"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={item.costoUnitario ?? ""}
              onChange={(e) => {
                const v = e.target.value
                onUpdate(index, "costoUnitario", v === "" ? null : (parseFloat(v) || 0))
              }}
              disabled={disabled}
              className="h-9"
            />
          </div>
        )}
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground shrink-0">Desc.</label>
          <Input
            type="text"
            inputMode="decimal"
            min="0"
            step="0.01"
            placeholder="0"
            value={descuentoStr}
            onChange={(e) => { setDescuentoStr(e.target.value); onUpdate(index, "descuentoValor", parseMoneyInput(e.target.value) || 0) }}
            disabled={disabled}
            className="w-20"
          />
          <Button
            type="button"
            variant={item.descuentoTipo === "fijo" ? "default" : "outline"}
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => onUpdate(index, "descuentoTipo", item.descuentoTipo === "fijo" ? "porcentaje" : "fijo")}
            disabled={disabled}
          >
            {item.descuentoTipo === "fijo" ? <DollarSign className="h-3 w-3" /> : <Percent className="h-3 w-3" />}
          </Button>
          <div className="flex-1 text-right">
            <span className="text-xs text-muted-foreground">Neto</span>
            <div className="font-medium text-sm">
              {hasDiscount && <span className="line-through text-muted-foreground text-xs mr-1">{formatPrice(bruto)}</span>}
              {formatPrice(neto)}
            </div>
          </div>
        </div>
        {showCostInfo && (
          <div className="text-xs text-muted-foreground flex justify-between">
            <span>Costo: {formatPrice(costoUnit)} · Total: {formatPrice(costoTotal)}</span>
            {margenPct !== null && <span className="text-success-600">margen {margenPct}%</span>}
          </div>
        )}
      </div>

      {/* Desktop Layout */}
      <div className="hidden sm:grid grid-cols-16 gap-2 items-center py-2 border-b" style={{ gridTemplateColumns: "4fr 1fr 1.5fr 1.5fr 1.5fr 2fr 0.5fr" }}>
        <div className="relative" ref={!showInvSearch ? undefined : searchRef}>
          <div className="flex gap-1">
            {showInvSearch ? (
              <Input
                placeholder="Buscar producto o servicio..."
                value={invSearch}
                onChange={(e) => setInvSearch(e.target.value)}
                autoFocus
                className="flex-1"
              />
            ) : (
              <Input
                placeholder="Descripción del item"
                value={item.descripcion}
                onChange={(e) => onUpdate(index, "descripcion", e.target.value)}
                disabled={disabled}
                className="flex-1"
              />
            )}
            <Button type="button" variant={vinculado ? "secondary" : "ghost"} size="icon" className="h-10 w-8 shrink-0" onClick={() => vinculado ? clearLink() : setShowInvSearch(!showInvSearch)} disabled={disabled} title={vinculado ? "Desvincular del catálogo" : "Buscar producto o servicio"}>
              {vinculado ? <X className="h-3.5 w-3.5" /> : <Package className="h-3.5 w-3.5" />}
            </Button>
          </div>
          {showInvSearch && invResults.length > 0 && (
            <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-md max-h-56 overflow-y-auto">
              {invResults.map((inv) => {
                if (inv.tipo === "SERVICIO") {
                  return (
                    <button key={`srv-${inv.id}`} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-accent" onClick={() => selectServicio(inv)}>
                      <div className="flex justify-between gap-2">
                        <div>
                          <span className="font-medium">{inv.nombre}</span>
                          <span className="ml-2 text-xs text-muted-foreground">{inv.codigo}</span>
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">Servicio</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Precio: {formatPrice(Number(inv.precio) || 0)}{inv.categoria ? ` · ${inv.categoria}` : ""}
                      </div>
                    </button>
                  )
                }
                const pc = Number(inv.precioCompra) || 0
                const pv = Number(inv.precioVenta) || 0
                const mPct = pv > 0 && pc > 0 ? Math.round(((pv - pc) / pv) * 100) : null
                const disp = (Number(inv.stock) || 0) - (Number(inv.stockReservado) || 0)
                return (
                  <button key={inv.id} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-accent" onClick={() => selectInvItem(inv)}>
                    <div className="flex justify-between gap-2">
                      <div>
                        <span className="font-medium">{inv.nombre}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{inv.codigo}</span>
                      </div>
                      <span className="text-xs shrink-0">
                        {disp <= 0 ? (
                          <span className="text-destructive font-medium">Sin stock</span>
                        ) : (
                          <span className="text-muted-foreground">Stock: {inv.stock}{inv.stockReservado > 0 ? ` (disp. ${disp})` : ""}</span>
                        )}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Costo: {formatPrice(pc)} · Venta: {formatPrice(pv)}{mPct !== null ? ` · margen ${mPct}%` : ""}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
          {showCostInfo && (
            <div className="text-[11px] text-muted-foreground mt-1 flex justify-between gap-2">
              <span>Costo {formatPrice(costoUnit)} · Total {formatPrice(costoTotal)}</span>
              {margenPct !== null && <span className="text-success-600">margen {margenPct}%</span>}
            </div>
          )}
          {!item.inventarioId && (
            <div className="mt-1 flex items-center gap-1">
              <span className="text-[11px] text-muted-foreground shrink-0">Costo:</span>
              <Input
                type="text"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder="opcional"
                value={item.costoUnitario ?? ""}
                onChange={(e) => {
                  const v = e.target.value
                  onUpdate(index, "costoUnitario", v === "" ? null : (parseFloat(v) || 0))
                }}
                disabled={disabled}
                className="h-7 text-xs"
              />
            </div>
          )}
          {showTipoRepuesto && (
            <Select
              value={item.tipoRepuesto || "NO_APLICA"}
              onValueChange={(v) => onUpdate(index, "tipoRepuesto", v)}
              disabled={disabled}
            >
              <SelectTrigger className="h-7 mt-1 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPO_REPUESTO_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div>
          <Select
            value={item.unidad || "Unidad"}
            onValueChange={(v) => onUpdate(index, "unidad", v)}
            disabled={disabled}
          >
            <SelectTrigger className="h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UNIDADES.map((u) => (
                <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Input
            type="text"
            inputMode="numeric"
            min="1"
            placeholder="Cant."
            value={cantidadStr}
            onChange={(e) => { setCantidadStr(e.target.value); onUpdate(index, "cantidad", parseInt(e.target.value) || 0) }}
            disabled={disabled}
          />
        </div>
        <div>
          <Input
            type="text"
            inputMode="decimal"
            min="0"
            step="0.01"
            placeholder="Precio"
            value={precioStr}
            onChange={(e) => { setPrecioStr(e.target.value); onUpdate(index, "precioUnitario", parseMoneyInput(e.target.value) || 0) }}
            disabled={disabled}
          />
        </div>
        <div className="flex items-center gap-1">
          <Input
            type="text"
            inputMode="decimal"
            min="0"
            step="0.01"
            placeholder="0"
            value={descuentoStr}
            onChange={(e) => { setDescuentoStr(e.target.value); onUpdate(index, "descuentoValor", parseMoneyInput(e.target.value) || 0) }}
            disabled={disabled}
            className="w-full"
          />
          <Button
            type="button"
            variant={item.descuentoTipo === "fijo" ? "default" : "outline"}
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => onUpdate(index, "descuentoTipo", item.descuentoTipo === "fijo" ? "porcentaje" : "fijo")}
            disabled={disabled}
          >
            {item.descuentoTipo === "fijo" ? <DollarSign className="h-3 w-3" /> : <Percent className="h-3 w-3" />}
          </Button>
        </div>
        <div className="text-right font-medium">
          {hasDiscount && <span className="line-through text-muted-foreground text-xs mr-1">{formatPrice(bruto)}</span>}
          {formatPrice(neto)}
        </div>
        <div className="text-right">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onRemove(index)}
            disabled={disabled}
            className="h-8 w-8 text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </>
  )
}
