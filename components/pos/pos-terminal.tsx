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
  Printer,
  Unplug,
  Loader2,
  AlertTriangle,
  RotateCcw,
} from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { PosProductSearch, type PosProductSearchRef } from "./pos-product-search"
import { PosCart } from "./pos-cart"
import { PosCheckoutDialog } from "./pos-checkout-dialog"
import { PosHeldSales } from "./pos-held-sales"
import { PosTicketShare } from "./pos-ticket-share"
import { PosDevolucionSearch, type VentaForDevolucion } from "./pos-devolucion-search"
import { DevolucionForm } from "@/components/ventas/devolucion-form"
import { usePosShortcuts } from "./use-pos-shortcuts"
import { useBarcodeScanner } from "./use-barcode-scanner"
import { useThermalPrinter } from "./use-thermal-printer"
import { BarcodeScanner } from "@/components/inventario/barcode-scanner"
import { useCurrency } from "@/contexts/currency-context"
import { generateTicketCommands } from "@/lib/escpos"
import type {
  PosCartItem,
  PosCliente,
  HeldSale,
  InventarioResult,
  DescuentoConfig,
  FiscalConfig,
} from "./pos-types"
import { EMPTY_CLIENT, nextLineId, computeVentaTotals } from "./pos-types"

const HELD_SALES_KEY = "pos_held_sales"

// Module-scope cache for notif config (rarely changes; avoid refetch on every POS mount).
let cachedNotifConfig: { data: any; ts: number } | null = null
const NOTIF_CONFIG_CACHE_MS = 60 * 60 * 1000 // 1h

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
  const { formatPrice, pais } = useCurrency()
  const { confirm, showSuccess, showError } = useModal()
  const searchRef = useRef<PosProductSearchRef>(null)

  // Cart state
  const [cartItems, setCartItems] = useState<PosCartItem[]>([])
  const [cliente, setCliente] = useState<PosCliente>({ ...EMPTY_CLIENT })
  const [showClienteSearch, setShowClienteSearch] = useState(false)
  const [descuentoGlobal, setDescuentoGlobal] = useState<DescuentoConfig | null>(null)
  const [descuentoMotivo, setDescuentoMotivo] = useState("")

  // UI state
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [heldSalesOpen, setHeldSalesOpen] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [heldSales, setHeldSales] = useState<HeldSale[]>([])
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [successData, setSuccessData] = useState<any>(null)
  const [plantillaCorta, setPlantillaCorta] = useState<string | undefined>(undefined)
  const [fiscal, setFiscal] = useState<FiscalConfig | null>(null)

  // Devolucion (return) flow
  const [devolucionOpen, setDevolucionOpen] = useState(false)
  const [devolucionVenta, setDevolucionVenta] = useState<VentaForDevolucion | null>(null)

  // Fetch fiscal config on mount
  useEffect(() => {
    fetch("/api/configuracion")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setFiscal({
            regimen: data.ivaRegimen ?? "EXENTO",
            tasa: data.ivaTasa ?? 21,
            redondeoEfectivo: data.redondeoEfectivo ?? 0,
          })
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    const now = Date.now()
    const fresh = cachedNotifConfig && now - cachedNotifConfig.ts < NOTIF_CONFIG_CACHE_MS

    if (fresh && cachedNotifConfig?.data?.plantillasWhatsapp?.venta_comprobante_corto) {
      setPlantillaCorta(cachedNotifConfig.data.plantillasWhatsapp.venta_comprobante_corto)
      return
    }

    fetch("/api/notificaciones/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) cachedNotifConfig = { data, ts: Date.now() }
        if (!cancelled && data?.plantillasWhatsapp?.venta_comprobante_corto) {
          setPlantillaCorta(data.plantillasWhatsapp.venta_comprobante_corto)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Caja session awareness: a cash sale made with no open caja session falls
  // outside any arqueo window, so the cash never shows up in the cash-register
  // reconciliation. We surface a banner (soft nudge) when no session is open.
  // null = still checking; re-checks on window focus so it clears after opening.
  const [cajaAbierta, setCajaAbierta] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    const check = () => {
      fetch("/api/caja/sesiones?current=true")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!cancelled) setCajaAbierta(!!data?.sesion)
        })
        .catch(() => {})
    }
    check()
    const onFocus = () => check()
    window.addEventListener("focus", onFocus)
    return () => {
      cancelled = true
      window.removeEventListener("focus", onFocus)
    }
  }, [])

  // Mobile tab state
  const [mobileTab, setMobileTab] = useState<MobileTab>("products")

  // Thermal printer
  const printer = useThermalPrinter()
  const [printing, setPrinting] = useState(false)

  // Printer width setting (58mm or 80mm)
  type PrinterWidth = 58 | 80
  const [printerWidth, setPrinterWidth] = useState<PrinterWidth>(() => {
    if (typeof window === "undefined") return 58
    const saved = localStorage.getItem("pos_printer_width")
    return saved === "80" ? 80 : 58
  })
  const handleSetPrinterWidth = (w: PrinterWidth) => {
    setPrinterWidth(w)
    localStorage.setItem("pos_printer_width", String(w))
  }

  // Computed values
  const cartCount = cartItems.reduce((sum, i) => sum + i.cantidad, 0)
  const cartTotal = computeVentaTotals(cartItems, descuentoGlobal, fiscal).total

  // Load held sales from localStorage + sync entre tabs.
  // storage event no dispara en la tab que originó el cambio: cubre el caso
  // de tener POS abierto en dos tabs y que ambas vean el mismo set.
  useEffect(() => {
    setHeldSales(loadHeldSales())
    const onStorage = (e: StorageEvent) => {
      if (e.key !== HELD_SALES_KEY) return
      setHeldSales(loadHeldSales())
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
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
          trackeaSeries: product.trackeaSeries ?? false,
          serieIds: [],
        },
      ]
    })
  }, [])

  const addManualProduct = useCallback((product: { nombre: string; precioUnitario: number; costo?: number }) => {
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
        trackeaSeries: false,
        serieIds: [],
        costo: product.costo,
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
          return { ...item, cantidad: newQty, serieIds: item.trackeaSeries ? [] : item.serieIds }
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

  const setSerieIds = useCallback((lineId: string, serieIds: string[]) => {
    setCartItems((prev) =>
      prev.map((item) => (item.lineId === lineId ? { ...item, serieIds } : item))
    )
  }, [])

  const setItemDescuento = useCallback((lineId: string, d: { tipo: import("./pos-types").TipoDescuento; valor: number }) => {
    setCartItems((prev) =>
      prev.map((item) =>
        item.lineId === lineId
          ? {
              ...item,
              tipoDescuento: d.tipo,
              descuento: d.tipo === "MONTO" ? d.valor : 0,
              porcentajeDescuento: d.tipo === "PORCENTAJE" ? d.valor : 0,
            }
          : item
      )
    )
  }, [])

  const setItemPrecio = useCallback((lineId: string, precio: number) => {
    setCartItems((prev) =>
      prev.map((item) =>
        item.lineId === lineId ? { ...item, precioUnitario: precio } : item
      )
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
      setDescuentoGlobal(null)
      setDescuentoMotivo("")
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
    setDescuentoGlobal(null)
    setDescuentoMotivo("")
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
      setDescuentoGlobal(null)
      setDescuentoMotivo("")
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

  // --- Print ticket ---
  const printTicket = useCallback(async (ventaData: any) => {
    if (!printer.connected) return false
    setPrinting(true)
    try {
      const ticketData = {
        numeroVenta: ventaData.numeroVenta,
        fecha: new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" }),
        cliente: {
          nombre: ventaData.clienteNombre || "Consumidor Final",
          telefono: ventaData.clienteTelefono,
        },
        vendedor: ventaData.vendedor?.nombre || "",
        items: (ventaData.items || []).map((item: any) => ({
          descripcion: item.descripcion,
          cantidad: item.cantidad,
          precioUnitario: item.precioUnitario,
          subtotal: item.cantidad * item.precioUnitario,
          diasGarantia: item.diasGarantia || 0,
        })),
        subtotal: ventaData.subtotal || ventaData.total,
        descuento: ventaData.descuento || 0,
        total: ventaData.total,
        metodoPago: ventaData.metodoPago,
        nombreEmpresa: ventaData.organizationName,
      }
      const commands = generateTicketCommands(ticketData, printerWidth)
      await printer.print(commands)
      return true
    } catch (err) {
      console.error("Print error:", err)
      return false
    } finally {
      setPrinting(false)
    }
  }, [printer])

  // --- Print ticket via browser print dialog (fallback when no USB printer) ---
  const printTicketHTML = useCallback((ventaData: any) => {
    const items = ventaData.items || []
    const subtotal = ventaData.subtotal ?? items.reduce((s: number, i: any) => s + i.cantidad * i.precioUnitario, 0)
    const descuento = ventaData.descuento || 0
    const total = ventaData.total
    const empresa = ventaData.organizationName || "Servicio Técnico"
    const cliente = ventaData.clienteNombre || "Consumidor Final"
    const fecha = new Date().toLocaleString("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires",
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    })
    const fmtPrice = (n: number) => "$ " + n.toLocaleString("es-AR", { minimumFractionDigits: 2 })

    const itemsHTML = items.map((item: any) => `
      <div style="margin-bottom:6px">
        <div style="font-weight:bold">${item.descripcion}</div>
        <div style="display:flex;justify-content:space-between;color:#555">
          <span>&nbsp;&nbsp;${item.cantidad} x ${fmtPrice(item.precioUnitario)}</span>
          <span style="font-weight:bold;color:#000">${fmtPrice(item.cantidad * item.precioUnitario)}</span>
        </div>
      </div>
    `).join("")

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Ticket Venta #${ventaData.numeroVenta}</title>
<style>
  @page { size: ${printerWidth}mm auto; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Courier New', Courier, monospace; font-size: ${printerWidth === 80 ? 13 : 12}px; width: ${printerWidth}mm; padding: ${printerWidth === 80 ? 10 : 8}px; color: #000; }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .sep { border-top: 1px dashed #999; margin: 6px 0; }
  .sep-bold { border-top: 2px solid #000; margin: 6px 0; }
  .row { display: flex; justify-content: space-between; }
  .total-box { background: #f5f5f5; padding: 6px; margin: 4px 0; }
  .big { font-size: 16px; }
  .small { font-size: 10px; color: #888; }
</style></head><body>
  <div class="center bold big">${empresa}</div>
  <div class="sep-bold"></div>
  <div class="center bold big">VENTA #${String(ventaData.numeroVenta).padStart(4, "0")}</div>
  <div class="center small">${fecha}</div>
  <div class="sep"></div>
  <div class="row"><span style="color:#666">Cliente:</span><span class="bold">${cliente}</span></div>
  ${ventaData.clienteTelefono ? `<div class="row"><span style="color:#666">Tel:</span><span>${ventaData.clienteTelefono}</span></div>` : ""}
  <div class="sep"></div>
  ${itemsHTML}
  <div class="sep-bold"></div>
  <div class="row"><span>Subtotal:</span><span>${fmtPrice(subtotal)}</span></div>
  ${descuento > 0 ? `<div class="row" style="color:#c00"><span>Descuento:</span><span>-${fmtPrice(descuento)}</span></div>` : ""}
  <div class="total-box row bold big"><span>TOTAL:</span><span>${fmtPrice(total)}</span></div>
  <div class="sep-bold"></div>
  <div class="center bold">¡Gracias por su compra!</div>
  <div class="center small">Conserve este ticket como comprobante</div>
  <br><br>
<script>window.onload=function(){window.print();}<\/script>
</body></html>`

    const printWindow = window.open("", "_blank", "width=320,height=600")
    if (printWindow) {
      printWindow.document.write(html)
      printWindow.document.close()
    }
  }, [])

  // --- Checkout ---
  const handleCheckoutComplete = useCallback(async (ventaData: any) => {
    setCheckoutOpen(false)
    setSuccessData(ventaData)
    setCartItems([])
    setCliente({ ...EMPTY_CLIENT })
    setShowClienteSearch(false)
    setDescuentoGlobal(null)
    setDescuentoMotivo("")

    // Auto-print ticket if printer connected
    if (printer.connected) {
      await printTicket(ventaData)
    }
  }, [printer.connected, printTicket])

  const handleSuccessClose = useCallback(() => {
    setSuccessData(null)
    setMobileTab("products")
    searchRef.current?.focusSearch()
  }, [])

  // --- Barcode scanner ---
  const handleBarcodeScan = useCallback(
    async (barcode: string) => {
      const code = barcode.trim()
      if (!code) return
      try {
        const res = await fetch(`/api/inventario/barcode?code=${encodeURIComponent(code)}`)
        if (!res.ok) return
        const data = await res.json()
        if (data.found && data.item) {
          if ((data.item.stock ?? 0) <= 0) {
            await showError(`"${data.item.nombre}" sin stock disponible`)
            return
          }
          addProduct({
            id: data.item.id,
            codigo: data.item.codigo,
            nombre: data.item.nombre,
            stock: data.item.stock,
            precioVenta: data.item.precioVenta,
          })
        } else {
          await showError(`Código "${code}" no encontrado en inventario`)
        }
      } catch {
        await showError("Error al buscar el código de barras")
      }
    },
    [addProduct, showError]
  )

  useBarcodeScanner({
    onScan: handleBarcodeScan,
    enabled: !checkoutOpen && !heldSalesOpen && !successData && !scannerOpen && !devolucionOpen && !devolucionVenta,
  })

  // --- Keyboard shortcuts ---
  usePosShortcuts({
    onNewSale: () => {
      setCartItems([])
      setCliente({ ...EMPTY_CLIENT })
      setShowClienteSearch(false)
      setDescuentoGlobal(null)
      setDescuentoMotivo("")
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
    enabled: !checkoutOpen && !heldSalesOpen && !successData && !devolucionOpen && !devolucionVenta,
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
          {/* Printer status/connect button */}
          {printer.isSupported && (
            <Button
              variant={printer.connected ? "ghost" : "outline"}
              size="sm"
              className={cn(
                "h-8 gap-1.5 text-xs",
                printer.connected && "text-success",
                printer.error && "text-destructive"
              )}
              onClick={printer.connected ? printer.disconnect : printer.connect}
              disabled={printer.connecting}
              title={
                printer.connected
                  ? `Conectada: ${printer.device?.name} (click para desconectar)`
                  : "Conectar impresora térmica"
              }
            >
              {printer.connecting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : printer.connected ? (
                <Printer className="h-3.5 w-3.5" />
              ) : (
                <Unplug className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">
                {printer.connecting ? "Conectando..." : printer.connected ? printer.device?.name?.substring(0, 15) : "Impresora"}
              </span>
            </Button>
          )}

          {/* Printer width toggle */}
          <div className="flex items-center rounded-md border overflow-hidden h-8">
            <button
              type="button"
              onClick={() => handleSetPrinterWidth(58)}
              className={cn(
                "px-2 h-full text-[10px] font-medium transition-colors",
                printerWidth === 58
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted"
              )}
              title="Impresora térmica 58mm"
            >
              58mm
            </button>
            <button
              type="button"
              onClick={() => handleSetPrinterWidth(80)}
              className={cn(
                "px-2 h-full text-[10px] font-medium transition-colors",
                printerWidth === 80
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted"
              )}
              title="Impresora térmica 80mm"
            >
              80mm
            </button>
          </div>

          {/* Devolucion button */}
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setDevolucionOpen(true)}
            title="Procesar devolución"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Devolución</span>
          </Button>

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

      {/* Caja cerrada: las ventas no entran en ningún arqueo */}
      {cajaAbierta === false && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-warning/30 bg-warning-50 px-3 py-2 text-sm font-medium text-warning-700 dark:bg-warning/10 dark:text-warning-500">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Caja cerrada — las ventas no quedan registradas en el arqueo.</span>
          </span>
          <Button
            asChild
            size="sm"
            variant="outline"
            className="h-8 shrink-0 border-warning/40 text-warning-700 hover:bg-warning-100 dark:text-warning-500 dark:hover:bg-warning/15"
          >
            <Link href="/caja">Abrir caja</Link>
          </Button>
        </div>
      )}

      {/* ===== Desktop: Split view ===== */}
      <div className="hidden lg:flex flex-1 overflow-hidden">
        {/* Left: Product search */}
        <div className="w-[60%] border-r overflow-hidden flex flex-col">
          <PosProductSearch ref={searchRef} onAddProduct={addProduct} onAddManualProduct={addManualProduct} onOpenScanner={() => setScannerOpen(true)} />
        </div>
        {/* Right: Cart */}
        <div className="w-[40%] overflow-hidden flex flex-col">
          <PosCart
            items={cartItems}
            cliente={cliente}
            onUpdateQuantity={updateQuantity}
            onRemoveItem={removeItem}
            onSetGarantia={setGarantia}
            onSetSerieIds={setSerieIds}
            onSetCliente={setCliente}
            onCheckout={() => cartItems.length > 0 && setCheckoutOpen(true)}
            onHoldSale={holdSale}
            onRecallSale={() => setHeldSalesOpen(true)}
            onClearCart={clearCart}
            heldCount={heldSales.length}
            showClienteSearch={showClienteSearch}
            onToggleClienteSearch={() => setShowClienteSearch((prev) => !prev)}
            descuentoGlobal={descuentoGlobal}
            descuentoMotivo={descuentoMotivo}
            onSetItemDescuento={setItemDescuento}
            onSetDescuentoGlobal={setDescuentoGlobal}
            onSetDescuentoMotivo={setDescuentoMotivo}
            onSetPrecio={setItemPrecio}
            fiscal={fiscal}
          />
        </div>
      </div>

      {/* ===== Mobile: Tab-based view ===== */}
      <div className="flex-1 flex flex-col lg:hidden overflow-hidden">
        {/* Content area — keep both mounted to preserve search state + scroll */}
        <div className="flex-1 overflow-hidden relative">
          <div
            style={{ display: mobileTab === "products" ? "block" : "none" }}
            className="absolute inset-0 overflow-hidden"
          >
            <PosProductSearch ref={searchRef} onAddProduct={addProduct} onAddManualProduct={addManualProduct} onOpenScanner={() => setScannerOpen(true)} />
          </div>
          <div
            style={{ display: mobileTab === "cart" ? "block" : "none" }}
            className="absolute inset-0 overflow-hidden"
          >
            <PosCart
              items={cartItems}
              cliente={cliente}
              onUpdateQuantity={updateQuantity}
              onRemoveItem={removeItem}
              onSetGarantia={setGarantia}
              onSetSerieIds={setSerieIds}
              onSetCliente={setCliente}
              onCheckout={() => cartItems.length > 0 && setCheckoutOpen(true)}
              onHoldSale={holdSale}
              onRecallSale={() => setHeldSalesOpen(true)}
              onClearCart={clearCart}
              heldCount={heldSales.length}
              showClienteSearch={showClienteSearch}
              onToggleClienteSearch={() => setShowClienteSearch((prev) => !prev)}
              descuentoGlobal={descuentoGlobal}
              descuentoMotivo={descuentoMotivo}
              onSetItemDescuento={setItemDescuento}
              onSetDescuentoGlobal={setDescuentoGlobal}
              onSetDescuentoMotivo={setDescuentoMotivo}
              onSetPrecio={setItemPrecio}
              fiscal={fiscal}
            />
          </div>
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
        <div className="lg:hidden fixed bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] left-4 right-4 z-[51]">
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
        descuentoGlobal={descuentoGlobal}
        descuentoMotivo={descuentoMotivo.trim() || undefined}
        fiscal={fiscal}
      />

      <PosHeldSales
        open={heldSalesOpen}
        onClose={() => setHeldSalesOpen(false)}
        heldSales={heldSales}
        onRecall={recallSale}
        onDelete={deleteHeldSale}
      />

      <PosDevolucionSearch
        open={devolucionOpen}
        onClose={() => setDevolucionOpen(false)}
        onVentaFound={(v) => {
          setDevolucionOpen(false)
          setDevolucionVenta(v)
        }}
      />

      {devolucionVenta && (
        <DevolucionForm
          open
          onOpenChange={(o) => {
            if (!o) setDevolucionVenta(null)
          }}
          venta={devolucionVenta}
          onSuccess={() => setDevolucionVenta(null)}
        />
      )}

      <BarcodeScanner
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        onResult={async (result) => {
          // Scanner ya consultó la API; reusar resultado en vez de re-fetchear.
          if (result.found && result.item) {
            if ((result.item.stock ?? 0) <= 0) {
              await showError(`"${result.item.nombre}" sin stock disponible`)
              return
            }
            addProduct({
              id: result.item.id,
              codigo: result.item.codigo,
              nombre: result.item.nombre,
              stock: result.item.stock,
              precioVenta: result.item.precioVenta,
            })
          } else {
            await showError(`Código "${result.code}" no encontrado en inventario`)
          }
        }}
      />

      {/* ===== Success overlay ===== */}
      {successData && (
        <div className="fixed inset-0 z-[60] bg-background/95 flex items-center justify-center p-4">
          <div className="max-w-sm w-full text-center space-y-4">
            <div className="mx-auto w-16 h-16 rounded-2xl bg-success/10 flex items-center justify-center">
              <Check className="h-8 w-8 text-success" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-success">Venta registrada</h2>
              <p className="text-muted-foreground mt-1">
                Venta #{successData.numeroVenta} — {formatPrice(successData.total)}
              </p>
              {successData.clienteNombre && (
                <p className="text-sm text-muted-foreground">{successData.clienteNombre}</p>
              )}
            </div>

            {successData.garantias?.length > 0 && (
              <p className="text-sm text-success">
                {successData.garantias.length} certificado(s) de garantía generados
              </p>
            )}

            {/* Auto-print indicator */}
            {printer.connected && (
              <p className="text-xs text-success">
                {printing ? "Imprimiendo ticket..." : "Ticket impreso automaticamente"}
              </p>
            )}

            <div className="flex flex-col gap-2">
              {/* Print buttons */}
              {printer.connected ? (
                <Button
                  variant="outline"
                  className="h-11"
                  onClick={() => printTicket(successData)}
                  disabled={printing}
                >
                  {printing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Printer className="mr-2 h-4 w-4" />
                  )}
                  {printing ? "Imprimiendo..." : "Reimprimir ticket"}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  className="h-11"
                  onClick={() => printTicketHTML(successData)}
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Imprimir ticket
                </Button>
              )}

              {/* WhatsApp share as image + download image */}
              <PosTicketShare ventaData={successData} plantillaCorta={plantillaCorta} countryCode={pais} />

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
