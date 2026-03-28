"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useModal } from "@/contexts/modal-context"
import {
  ArrowLeft,
  Keyboard,
  Monitor,
  Check,
  FileText,
  ShoppingCart,
  Package,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { PosProductSearch, type PosProductSearchRef } from "./pos-product-search"
import { PosCart } from "./pos-cart"
import { PosCheckoutDialog } from "./pos-checkout-dialog"
import { PosHeldSales } from "./pos-held-sales"
import { usePosShortcuts } from "./use-pos-shortcuts"
import { useBarcodeScanner } from "./use-barcode-scanner"
import { useCurrency } from "@/contexts/currency-context"
import type {
  PosCartItem,
  PosCliente,
  HeldSale,
  InventarioResult,
} from "./pos-types"
import { EMPTY_CLIENT, nextLineId } from "./pos-types"

// WhatsApp icon SVG
function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}

const HELD_SALES_KEY = "pos_held_sales"

function loadHeldSales(): HeldSale[] {
  try {
    const raw = localStorage.getItem(HELD_SALES_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveHeldSales(sales: HeldSale[]) {
  localStorage.setItem(HELD_SALES_KEY, JSON.stringify(sales))
}

type MobileTab = "products" | "cart"

export function PosTerminal() {
  const router = useRouter()
  const { formatPrice } = useCurrency()
  const { confirm, showSuccess } = useModal()
  const searchRef = useRef<PosProductSearchRef>(null)

  // Cart state
  const [cartItems, setCartItems] = useState<PosCartItem[]>([])
  const [cliente, setCliente] = useState<PosCliente>({ ...EMPTY_CLIENT })
  const [showClienteSearch, setShowClienteSearch] = useState(false)

  // UI state
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [heldSalesOpen, setHeldSalesOpen] = useState(false)
  const [heldSales, setHeldSales] = useState<HeldSale[]>([])
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [successData, setSuccessData] = useState<any>(null)

  // Mobile tab state
  const [mobileTab, setMobileTab] = useState<MobileTab>("products")

  // Computed values
  const cartCount = cartItems.reduce((sum, i) => sum + i.cantidad, 0)
  const cartTotal = cartItems.reduce((sum, i) => sum + i.precioUnitario * i.cantidad, 0)

  // Load held sales from localStorage
  useEffect(() => {
    setHeldSales(loadHeldSales())
  }, [])

  // Auto-switch to cart on mobile when first item is added
  const prevCartCount = useRef(0)
  useEffect(() => {
    if (cartCount > 0 && prevCartCount.current === 0) {
      // Don't auto-switch, let the user stay on products to keep adding
    }
    prevCartCount.current = cartCount
  }, [cartCount])

  // --- Cart operations ---
  const addProduct = useCallback((product: InventarioResult) => {
    setCartItems((prev) => {
      const existing = prev.find((item) => item.inventarioId === product.id)
      if (existing) {
        if (existing.cantidad >= product.stock) return prev
        return prev.map((item) =>
          item.lineId === existing.lineId
            ? { ...item, cantidad: item.cantidad + 1, stockDisponible: product.stock }
            : item
        )
      }
      return [
        ...prev,
        {
          lineId: nextLineId(),
          inventarioId: product.id,
          codigo: product.codigo,
          nombre: product.nombre,
          precioUnitario: product.precioVenta,
          cantidad: 1,
          stockDisponible: product.stock,
          diasGarantia: 0,
        },
      ]
    })
  }, [])

  const addManualProduct = useCallback((product: { nombre: string; precioUnitario: number }) => {
    setCartItems((prev) => [
      ...prev,
      {
        lineId: nextLineId(),
        inventarioId: null,
        codigo: "",
        nombre: product.nombre,
        precioUnitario: product.precioUnitario,
        cantidad: 1,
        stockDisponible: 999,
        diasGarantia: 0,
      },
    ])
  }, [])

  const updateQuantity = useCallback((lineId: string, delta: number) => {
    setCartItems((prev) =>
      prev
        .map((item) => {
          if (item.lineId !== lineId) return item
          const newQty = item.cantidad + delta
          if (newQty <= 0) return null
          if (item.inventarioId && newQty > item.stockDisponible) return item
          return { ...item, cantidad: newQty }
        })
        .filter(Boolean) as PosCartItem[]
    )
  }, [])

  const removeItem = useCallback((lineId: string) => {
    setCartItems((prev) => prev.filter((item) => item.lineId !== lineId))
  }, [])

  const setGarantia = useCallback((lineId: string, dias: number) => {
    setCartItems((prev) =>
      prev.map((item) => (item.lineId === lineId ? { ...item, diasGarantia: dias } : item))
    )
  }, [])

  const clearCart = useCallback(async () => {
    if (cartItems.length === 0) return
    const confirmed = await confirm({
      title: "Vaciar carrito",
      description: "¿Desea eliminar todos los productos del carrito?",
      confirmText: "Vaciar",
      cancelText: "Cancelar",
      variant: "danger",
    })
    if (confirmed) {
      setCartItems([])
      setCliente({ ...EMPTY_CLIENT })
      setShowClienteSearch(false)
    }
  }, [cartItems.length, confirm])

  // --- Hold/Recall ---
  const holdSale = useCallback(async () => {
    if (cartItems.length === 0) return
    const held: HeldSale = {
      id: `held_${Date.now()}`,
      timestamp: Date.now(),
      cliente: { ...cliente },
      items: [...cartItems],
      nota: "",
    }
    const updated = [...heldSales, held]
    setHeldSales(updated)
    saveHeldSales(updated)
    setCartItems([])
    setCliente({ ...EMPTY_CLIENT })
    setShowClienteSearch(false)
    setMobileTab("products")
  }, [cartItems, cliente, heldSales])

  const recallSale = useCallback(
    (id: string) => {
      const sale = heldSales.find((s) => s.id === id)
      if (!sale) return

      if (cartItems.length > 0) {
        const currentHeld: HeldSale = {
          id: `held_${Date.now()}`,
          timestamp: Date.now(),
          cliente: { ...cliente },
          items: [...cartItems],
          nota: "",
        }
        const withCurrent = [...heldSales, currentHeld]
        const withoutRecalled = withCurrent.filter((s) => s.id !== id)
        setHeldSales(withoutRecalled)
        saveHeldSales(withoutRecalled)
      } else {
        const updated = heldSales.filter((s) => s.id !== id)
        setHeldSales(updated)
        saveHeldSales(updated)
      }

      setCartItems(sale.items)
      setCliente(sale.cliente)
      setMobileTab("cart")
    },
    [heldSales, cartItems, cliente]
  )

  const deleteHeldSale = useCallback(
    (id: string) => {
      const updated = heldSales.filter((s) => s.id !== id)
      setHeldSales(updated)
      saveHeldSales(updated)
    },
    [heldSales]
  )

  // --- Checkout ---
  const handleCheckoutComplete = useCallback((ventaData: any) => {
    setCheckoutOpen(false)
    setSuccessData(ventaData)
    setCartItems([])
    setCliente({ ...EMPTY_CLIENT })
    setShowClienteSearch(false)
  }, [])

  const handleSuccessClose = useCallback(() => {
    setSuccessData(null)
    setMobileTab("products")
    searchRef.current?.focusSearch()
  }, [])

  // --- Barcode scanner ---
  const handleBarcodeScan = useCallback(
    async (barcode: string) => {
      try {
        const res = await fetch(`/api/inventario/search?q=${encodeURIComponent(barcode)}&limit=1`)
        const data = await res.json()
        if (Array.isArray(data) && data.length > 0) {
          addProduct(data[0])
        }
      } catch {
        // ignore
      }
    },
    [addProduct]
  )

  useBarcodeScanner({
    onScan: handleBarcodeScan,
    enabled: !checkoutOpen && !heldSalesOpen && !successData,
  })

  // --- Keyboard shortcuts ---
  usePosShortcuts({
    onNewSale: () => {
      setCartItems([])
      setCliente({ ...EMPTY_CLIENT })
      setShowClienteSearch(false)
      setMobileTab("products")
      searchRef.current?.focusSearch()
    },
    onSearchFocus: () => {
      setMobileTab("products")
      searchRef.current?.focusSearch()
    },
    onHoldSale: holdSale,
    onRecallSale: () => setHeldSalesOpen(true),
    onCheckout: () => {
      if (cartItems.length > 0) setCheckoutOpen(true)
    },
    onToggleClient: () => {
      setMobileTab("cart")
      setShowClienteSearch((prev) => !prev)
    },
    enabled: !checkoutOpen && !heldSalesOpen && !successData,
  })

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* ===== Top bar ===== */}
      <header className="h-12 border-b bg-background flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => router.push("/ventas")}
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Salir</span>
          </Button>
          <div className="flex items-center gap-2">
            <Monitor className="h-4 w-4 text-primary" />
            <h1 className="font-semibold text-sm sm:text-base">Punto de Venta</h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Shortcuts toggle - desktop only */}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs hidden lg:flex"
            onClick={() => setShowShortcuts(!showShortcuts)}
          >
            <Keyboard className="h-3.5 w-3.5" />
            Atajos
          </Button>
        </div>
      </header>

      {/* Shortcuts bar - desktop only */}
      {showShortcuts && (
        <div className="hidden lg:flex bg-muted border-b px-3 py-2 flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground shrink-0">
          <span><kbd className="px-1.5 py-0.5 rounded bg-background border text-[10px] font-mono">F2</kbd> Nueva venta</span>
          <span><kbd className="px-1.5 py-0.5 rounded bg-background border text-[10px] font-mono">F4</kbd> Buscar producto</span>
          <span><kbd className="px-1.5 py-0.5 rounded bg-background border text-[10px] font-mono">F5</kbd> Apartar venta</span>
          <span><kbd className="px-1.5 py-0.5 rounded bg-background border text-[10px] font-mono">F6</kbd> Recuperar venta</span>
          <span><kbd className="px-1.5 py-0.5 rounded bg-background border text-[10px] font-mono">F7</kbd> Cliente</span>
          <span><kbd className="px-1.5 py-0.5 rounded bg-background border text-[10px] font-mono">F8</kbd> Cobrar</span>
          <span><kbd className="px-1.5 py-0.5 rounded bg-background border text-[10px] font-mono">Scanner</kbd> Código de barras</span>
        </div>
      )}

      {/* ===== Desktop: Split view ===== */}
      <div className="hidden lg:flex flex-1 overflow-hidden">
        {/* Left: Product search */}
        <div className="w-[60%] border-r overflow-hidden flex flex-col">
          <PosProductSearch ref={searchRef} onAddProduct={addProduct} onAddManualProduct={addManualProduct} />
        </div>
        {/* Right: Cart */}
        <div className="w-[40%] overflow-hidden flex flex-col">
          <PosCart
            items={cartItems}
            cliente={cliente}
            onUpdateQuantity={updateQuantity}
            onRemoveItem={removeItem}
            onSetGarantia={setGarantia}
            onSetCliente={setCliente}
            onCheckout={() => cartItems.length > 0 && setCheckoutOpen(true)}
            onHoldSale={holdSale}
            onRecallSale={() => setHeldSalesOpen(true)}
            onClearCart={clearCart}
            heldCount={heldSales.length}
            showClienteSearch={showClienteSearch}
            onToggleClienteSearch={() => setShowClienteSearch((prev) => !prev)}
          />
        </div>
      </div>

      {/* ===== Mobile: Tab-based view ===== */}
      <div className="flex-1 flex flex-col lg:hidden overflow-hidden">
        {/* Content area */}
        <div className="flex-1 overflow-hidden">
          {mobileTab === "products" ? (
            <PosProductSearch ref={searchRef} onAddProduct={addProduct} onAddManualProduct={addManualProduct} />
          ) : (
            <PosCart
              items={cartItems}
              cliente={cliente}
              onUpdateQuantity={updateQuantity}
              onRemoveItem={removeItem}
              onSetGarantia={setGarantia}
              onSetCliente={setCliente}
              onCheckout={() => cartItems.length > 0 && setCheckoutOpen(true)}
              onHoldSale={holdSale}
              onRecallSale={() => setHeldSalesOpen(true)}
              onClearCart={clearCart}
              heldCount={heldSales.length}
              showClienteSearch={showClienteSearch}
              onToggleClienteSearch={() => setShowClienteSearch((prev) => !prev)}
            />
          )}
        </div>

        {/* Mobile bottom tab bar */}
        <div className="shrink-0 border-t bg-background safe-area-bottom">
          <div className="grid grid-cols-2 h-14">
            <button
              type="button"
              onClick={() => setMobileTab("products")}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 transition-colors",
                mobileTab === "products"
                  ? "text-primary bg-primary/5"
                  : "text-muted-foreground"
              )}
            >
              <Package className="h-5 w-5" />
              <span className="text-[10px] font-medium">Productos</span>
            </button>
            <button
              type="button"
              onClick={() => setMobileTab("cart")}
              className={cn(
                "relative flex flex-col items-center justify-center gap-0.5 transition-colors",
                mobileTab === "cart"
                  ? "text-primary bg-primary/5"
                  : "text-muted-foreground"
              )}
            >
              <div className="relative">
                <ShoppingCart className="h-5 w-5" />
                {cartCount > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold px-1">
                    {cartCount}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-medium">
                {cartTotal > 0 ? formatPrice(cartTotal) : "Carrito"}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* ===== Mobile: Floating cart badge (on products tab) ===== */}
      {mobileTab === "products" && cartCount > 0 && (
        <div className="lg:hidden fixed bottom-20 left-4 right-4 z-[51] safe-area-bottom">
          <button
            type="button"
            onClick={() => setMobileTab("cart")}
            className="w-full flex items-center justify-between bg-primary text-primary-foreground rounded-xl px-4 py-3 shadow-lg active:scale-[0.98] transition-transform"
          >
            <div className="flex items-center gap-3">
              <div className="relative">
                <ShoppingCart className="h-5 w-5" />
                <span className="absolute -top-1 -right-1.5 min-w-[16px] h-[16px] flex items-center justify-center rounded-full bg-primary-foreground text-primary text-[9px] font-bold px-0.5">
                  {cartCount}
                </span>
              </div>
              <span className="text-sm font-medium">Ver carrito</span>
            </div>
            <span className="text-lg font-bold">{formatPrice(cartTotal)}</span>
          </button>
        </div>
      )}

      {/* ===== Dialogs ===== */}
      <PosCheckoutDialog
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        items={cartItems}
        cliente={cliente}
        onComplete={handleCheckoutComplete}
      />

      <PosHeldSales
        open={heldSalesOpen}
        onClose={() => setHeldSalesOpen(false)}
        heldSales={heldSales}
        onRecall={recallSale}
        onDelete={deleteHeldSale}
      />

      {/* ===== Success overlay ===== */}
      {successData && (
        <div className="fixed inset-0 z-[60] bg-background/95 flex items-center justify-center p-4">
          <div className="max-w-sm w-full text-center space-y-4">
            <div className="mx-auto w-16 h-16 rounded-full bg-green-100 dark:bg-green-950 flex items-center justify-center">
              <Check className="h-8 w-8 text-green-600" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-green-600">Venta registrada</h2>
              <p className="text-muted-foreground mt-1">
                Venta #{successData.numeroVenta} — {formatPrice(successData.total)}
              </p>
              {successData.clienteNombre && (
                <p className="text-sm text-muted-foreground">{successData.clienteNombre}</p>
              )}
            </div>

            {successData.garantias?.length > 0 && (
              <p className="text-sm text-green-600">
                {successData.garantias.length} certificado(s) de garantía generados
              </p>
            )}

            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                className="h-11"
                onClick={() => window.open(`/api/ventas/${successData.id}/pdf?format=ticket`, "_blank")}
              >
                <FileText className="mr-2 h-4 w-4" />
                Imprimir comprobante
              </Button>

              {successData.clienteTelefono && (
                <Button
                  variant="outline"
                  className="h-11 text-green-600 border-green-300"
                  onClick={() => {
                    const msg = encodeURIComponent(
                      `Hola ${successData.clienteNombre}, gracias por tu compra! Venta #${successData.numeroVenta} por ${formatPrice(successData.total)}. Comprobante: ${window.location.origin}/api/ventas/${successData.id}/pdf`
                    )
                    const phone = successData.clienteTelefono.replace(/\D/g, "")
                    window.open(`https://wa.me/54${phone}?text=${msg}`, "_blank")
                  }}
                >
                  <WhatsAppIcon className="mr-2 h-4 w-4" />
                  Enviar por WhatsApp
                </Button>
              )}

              <Button onClick={handleSuccessClose} className="h-12 text-lg font-semibold">
                Nueva Venta
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
