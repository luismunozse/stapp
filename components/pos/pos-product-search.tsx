"use client"

import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react"
import { Input } from "@/components/ui/input"
import { parseMoneyInput } from "@/lib/parse-money"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Search, Package, Loader2, Plus, Barcode, PenLine, X, ScanLine, MapPin } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import type { InventarioResult } from "./pos-types"
import { EmptyState } from "@/components/ui/empty-state"

interface ManualProduct {
  nombre: string
  precioUnitario: number
  costo?: number
}

/** The sucursal a POS sale will actually draw stock from — resolved server-side. */
export interface VentaSucursalInfo {
  id: string | null
  nombre: string | null
}

interface PosProductSearchProps {
  onAddProduct: (product: InventarioResult) => void
  onAddManualProduct: (product: ManualProduct) => void
  onOpenScanner?: () => void
  scanSuccess?: { nombre: string } | null
  /** Reports the sale's resolved sucursal once, from the initial products load. */
  onVentaSucursal?: (info: VentaSucursalInfo) => void
}

/** Reads the X-Venta-Sucursal-* headers set by search/route.ts under scope=venta. */
function readVentaSucursalHeaders(res: Response): VentaSucursalInfo {
  const nombreRaw = res.headers?.get("X-Venta-Sucursal-Nombre")
  return {
    id: res.headers?.get("X-Venta-Sucursal-Id") || null,
    nombre: nombreRaw ? decodeURIComponent(nombreRaw) : null,
  }
}

export interface PosProductSearchRef {
  focusSearch: () => void
}

// ─── Cross-sucursal stock popover ───────────────────────────────────────────

interface DepositoStockRow {
  depositoId: string
  depositoNombre: string
  sucursalNombre: string | null
  stock: number
  disponible: number
}

interface StockOtrasSucursalesProps {
  inventarioId: string
  productName: string
}

function StockOtrasSucursales({ inventarioId, productName }: StockOtrasSucursalesProps) {
  const [rows, setRows] = useState<DepositoStockRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  const loadStock = useCallback(async () => {
    if (rows !== null) return // already loaded
    setLoading(true)
    try {
      const res = await fetch(`/api/inventario/${inventarioId}/depositos`)
      if (!res.ok) throw new Error("fetch failed")
      const json = await res.json()
      setRows((json.data || []) as DepositoStockRow[])
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [inventarioId, rows])

  const handleOpen = (isOpen: boolean) => {
    setOpen(isOpen)
    if (isOpen) loadStock()
  }

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
          }}
          className="absolute top-2 right-2 flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors z-10"
          title="Ver stock en otras sucursales"
          aria-label="Ver stock en otras sucursales"
        >
          <MapPin className="h-3 w-3" />
          <span className="hidden sm:inline">Otras</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="w-72 p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-2">
          <p className="text-xs font-semibold truncate">{productName}</p>
          <p className="text-[10px] text-muted-foreground">Stock por sucursal / depósito</p>
          {loading ? (
            <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Cargando...
            </div>
          ) : !rows || rows.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">Sin datos de stock por depósito.</p>
          ) : (
            <div className="space-y-1">
              {rows.map((row) => (
                <div
                  key={row.depositoId}
                  className="flex items-center justify-between text-xs py-1 border-b border-border/50 last:border-0"
                >
                  <div className="min-w-0">
                    <span className="font-medium truncate block">
                      {row.sucursalNombre ?? row.depositoNombre}
                    </span>
                    {row.sucursalNombre && (
                      <span className="text-[10px] text-muted-foreground block truncate">
                        {row.depositoNombre}
                      </span>
                    )}
                  </div>
                  <span
                    className={`ml-2 shrink-0 font-semibold tabular-nums ${
                      row.disponible > 0 ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {row.disponible}
                  </span>
                </div>
              ))}
            </div>
          )}
          <p className="text-[9px] text-muted-foreground pt-1">
            Solo lectura — para transferir usá el módulo de transferencias.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────

export const PosProductSearch = forwardRef<PosProductSearchRef, PosProductSearchProps>(
  function PosProductSearch({ onAddProduct, onAddManualProduct, onOpenScanner, scanSuccess, onVentaSucursal }, ref) {
    const { formatPrice } = useCurrency()
    const inputRef = useRef<HTMLInputElement>(null)
    const manualNameRef = useRef<HTMLInputElement>(null)
    const manualPriceRef = useRef<HTMLInputElement>(null)
    const [query, setQuery] = useState("")
    const [results, setResults] = useState<InventarioResult[]>([])
    const [loading, setLoading] = useState(false)
    const [recentProducts, setRecentProducts] = useState<InventarioResult[]>([])
    const [initialLoad, setInitialLoad] = useState(true)
    const [showManualForm, setShowManualForm] = useState(false)
    const [manualNombre, setManualNombre] = useState("")
    // Draft en string para permitir escribir decimales (coma es-AR) sin que el
    // valor se colapse al parsear en cada tecla. Se parsea al agregar.
    const [manualPrecio, setManualPrecio] = useState("")
    const [manualCosto, setManualCosto] = useState("")

    useImperativeHandle(ref, () => ({
      focusSearch: () => {
        inputRef.current?.focus()
        inputRef.current?.select()
      },
    }))

    // Load initial/popular products. scope=venta keeps stock consistent with what
    // a sale can actually decrement (see app/api/inventario/search/route.ts); the
    // response headers also carry the resolved sucursal for the "selling from"
    // indicator, reported once here since this fetch always runs on mount.
    useEffect(() => {
      const loadInitial = async () => {
        try {
          const res = await fetch("/api/inventario/search?q=&limit=20&scope=venta")
          const data = await res.json()
          if (Array.isArray(data)) {
            setRecentProducts(data)
          }
          onVentaSucursal?.(readVentaSucursalHeaders(res))
        } catch {
          // ignore
        } finally {
          setInitialLoad(false)
        }
      }
      loadInitial()
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Debounced search
    useEffect(() => {
      if (!query.trim()) {
        setResults([])
        return
      }

      const timer = setTimeout(async () => {
        setLoading(true)
        try {
          const res = await fetch(`/api/inventario/search?q=${encodeURIComponent(query)}&limit=20&scope=venta`)
          const data = await res.json()
          setResults(Array.isArray(data) ? data : [])
        } catch {
          setResults([])
        } finally {
          setLoading(false)
        }
      }, 200)

      return () => clearTimeout(timer)
    }, [query])

    const handleAdd = useCallback((product: InventarioResult) => {
      onAddProduct(product)
      setQuery("")
      setResults([])
      inputRef.current?.focus()
    }, [onAddProduct])

    const handleAddManual = useCallback(() => {
      const nombre = manualNombre.trim()
      const precio = parseMoneyInput(manualPrecio)
      if (!nombre || !(precio > 0)) return
      const costoNum = parseMoneyInput(manualCosto)
      onAddManualProduct({
        nombre,
        precioUnitario: precio,
        costo: Number.isFinite(costoNum) ? costoNum : undefined,
      })
      setManualNombre("")
      setManualPrecio("")
      setManualCosto("")
      setShowManualForm(false)
      setQuery("")
      setResults([])
      inputRef.current?.focus()
    }, [manualNombre, manualPrecio, manualCosto, onAddManualProduct])

    const openManualForm = useCallback(() => {
      setShowManualForm(true)
      setManualNombre("")
      setManualPrecio("")
      setManualCosto("")
      setTimeout(() => manualNameRef.current?.focus(), 100)
    }, [])

    // Handle barcode scan in the input itself (fast typing + Enter)
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && results.length === 1) {
        e.preventDefault()
        handleAdd(results[0])
      }
    }

    const displayProducts = query.trim() ? results : recentProducts

    return (
      <div className="flex flex-col h-full">
        {/* Search bar + Manual button */}
        <div className="p-3 border-b bg-background sticky top-0 z-10 space-y-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Buscar producto o escanear código..."
                className="pl-10 pr-10 h-12 text-base sm:text-lg"
                autoFocus
              />
              {loading && (
                <Loader2 className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-muted-foreground" />
              )}
              {!loading && query && (
                <Barcode className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground/40" />
              )}
            </div>
            {/* Scan barcode button (manual trigger — useful on touch/mobile) */}
            {onOpenScanner && (
              <Button
                variant="outline"
                className="h-12 shrink-0 gap-1.5 px-3"
                onClick={onOpenScanner}
                title="Escanear código de barras"
              >
                <ScanLine className="h-4 w-4" />
                <span className="hidden sm:inline text-sm">Escanear</span>
              </Button>
            )}
            {/* Always-visible manual product button */}
            <Button
              variant={showManualForm ? "default" : "outline"}
              className="h-12 shrink-0 gap-1.5 px-3"
              onClick={() => {
                if (showManualForm) {
                  setShowManualForm(false)
                } else {
                  openManualForm()
                }
              }}
              title="Agregar producto manual (sin inventario)"
            >
              <PenLine className="h-4 w-4" />
              <span className="hidden sm:inline text-sm">Manual</span>
            </Button>
          </div>
          {/* Item 5: scan feedback — brief green flash when barcode adds a product */}
          {scanSuccess && (
            <div className="flex items-center gap-1.5 px-1 py-1 rounded-md bg-success/10 border border-success/20 text-success text-xs font-medium animate-in fade-in slide-in-from-top-1 duration-150">
              <span className="text-success">✓</span>
              <span className="truncate">{scanSuccess.nombre}</span>
            </div>
          )}
          {!query.trim() && !showManualForm && (
            <p className="text-xs text-muted-foreground px-1">
              Productos disponibles en stock
            </p>
          )}
          {query.trim() && !loading && !showManualForm && (
            <p className="text-xs text-muted-foreground px-1">
              {results.length} resultado{results.length !== 1 ? "s" : ""}
              {results.length === 1 && " — Enter para agregar"}
            </p>
          )}
        </div>

        {/* Manual product form - slides in above grid */}
        {showManualForm && (
          <div className="border-b bg-muted/30 p-3">
            <div className="max-w-lg mx-auto space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Producto manual (sin inventario)</p>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setShowManualForm(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <Input
                    ref={manualNameRef}
                    value={manualNombre}
                    onChange={(e) => setManualNombre(e.target.value)}
                    placeholder="Descripción del producto"
                    className="h-11"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        manualPriceRef.current?.focus()
                      }
                    }}
                  />
                </div>
                <div className="w-28">
                  <Input
                    ref={manualPriceRef}
                    type="text"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={manualPrecio}
                    onChange={(e) => setManualPrecio(e.target.value)}
                    placeholder="Precio"
                    className="h-11 text-base font-medium"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        handleAddManual()
                      }
                    }}
                  />
                </div>
                <div className="w-24">
                  <Input
                    type="text"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={manualCosto}
                    onChange={(e) => setManualCosto(e.target.value)}
                    placeholder="Costo"
                    className="h-11 text-sm"
                    title="Costo (opcional) — para margen correcto en reportes"
                  />
                </div>
                <Button
                  className="h-11 px-4"
                  onClick={handleAddManual}
                  disabled={!manualNombre.trim() || !(parseMoneyInput(manualPrecio) > 0)}
                >
                  <Plus className="h-4 w-4 sm:mr-1.5" />
                  <span className="hidden sm:inline">Agregar</span>
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Product grid */}
        <div className="flex-1 overflow-y-auto p-3 max-h-[70dvh] lg:max-h-none">
          {initialLoad ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="h-24 rounded-lg bg-muted animate-pulse" />
              ))}
            </div>
          ) : displayProducts.length === 0 ? (
            <EmptyState
              icon={Package}
              title={query.trim() ? "Sin resultados" : "Sin productos"}
              description={query.trim() ? "No se encontraron productos en inventario" : "Sin productos en inventario"}
              variant="search"
              action={query.trim() && !loading && !showManualForm ? { label: "Agregar manualmente", onClick: openManualForm } : undefined}
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-2 pb-20 lg:pb-0">
              {displayProducts.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => handleAdd(product)}
                  className="group relative flex flex-col items-start rounded-xl border bg-card p-3 sm:p-3 text-left transition-all hover:border-primary hover:shadow-md active:scale-[0.97] min-h-[5.5rem]"
                >
                  {/* Cross-sucursal stock popover — read only, no add-to-cart */}
                  <StockOtrasSucursales
                    inventarioId={product.id}
                    productName={product.nombre}
                  />

                  <div className="flex items-center gap-1.5 mb-1">
                    <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-[10px] font-mono text-muted-foreground truncate">
                      {product.codigo}
                    </span>
                  </div>
                  <span className="text-sm font-medium line-clamp-2 leading-tight mb-auto">
                    {product.nombre}
                  </span>
                  <div className="flex items-center justify-between w-full mt-2">
                    <span className="text-sm sm:text-base font-bold text-primary">
                      {formatPrice(product.precioVenta)}
                    </span>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                      product.stock <= 3
                        ? "bg-destructive/10 text-destructive"
                        : "bg-muted text-muted-foreground"
                    }`}>
                      Stock: {product.stock}
                    </span>
                  </div>
                  {/* Quick add overlay - desktop only */}
                  <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none hidden sm:flex">
                    <div className="bg-primary text-primary-foreground rounded-full p-1.5">
                      <Plus className="h-4 w-4" />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }
)
