"use client"

import { useEffect, useRef, useState } from "react"
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  FileText,
  Loader2,
  Printer,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useCurrency } from "@/contexts/currency-context"
import { cn } from "@/lib/utils"
import { PosTicketShare } from "./pos-ticket-share"
import { METODO_LABELS } from "./metodo-pago-labels"
import type { CobroMostrador } from "./pos-types"

/** Cuántos ítems se ven antes de colapsar el resto detrás de "y N más". */
const ITEMS_VISIBLES = 3
/** Ventana inicial en la que Enter no cierra el overlay. */
const GRACIA_ENTER_MS = 500

export function textoGarantias(cantidad: number): string {
  return cantidad === 1
    ? "1 certificado de garantía generado"
    : `${cantidad} certificados de garantía generados`
}

interface VentaExitoItem {
  descripcion: string
  cantidad: number
  precioUnitario: number
  subtotal?: number
}

interface VentaExitoPago {
  metodoPago: string
  monto: number
}

// Forma real de la respuesta de POST /api/ventas (formatVenta + organizationName).
interface VentaExito {
  id: string
  numeroVenta: number
  clienteNombre?: string | null
  clienteTelefono?: string | null
  subtotal?: number | null
  total: number
  descuento?: number | null
  saldoPendiente?: number | null
  metodoPago: string
  items?: VentaExitoItem[]
  pagos?: VentaExitoPago[]
  garantias?: Array<{ numeroGarantia: string | number; diasValidez: number }>
  [key: string]: unknown
}

interface ComprobanteFE {
  tipo?: string
  numero?: string | number
  pdf_url?: string | null
  yaEmitido?: boolean
}

interface PosVentaExitoProps {
  venta: VentaExito
  /** Solo en efectivo puro con monto recibido: habilita el vuelto como héroe. */
  cobro?: CobroMostrador | null
  onClose: () => void
  /** Imprime por la térmica si está conectada; si no, por el diálogo del navegador. */
  onPrint: () => void
  printer: { connected: boolean; printing: boolean }
  facturacion: {
    disponible: boolean
    emitiendo: boolean
    comprobante: ComprobanteFE | null
    error: string | null
    onEmitir: () => void
  }
  plantillaCorta?: string
  countryCode?: string | null
  buildManualWhatsAppUrl: (phone: string, venta: any) => string
}

// Enter cierra el overlay, salvo que el foco esté en algo que ya usa Enter.
const INTERACTIVO = "input, textarea, select, button, a, [role='menuitem'], [contenteditable='true']"

export function PosVentaExito({
  venta,
  cobro,
  onClose,
  onPrint,
  printer,
  facturacion,
  plantillaCorta,
  countryCode,
  buildManualWhatsAppUrl,
}: PosVentaExitoProps) {
  const { formatPrice } = useCurrency()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [expandido, setExpandido] = useState(false)

  const items = venta.items ?? []
  const ocultos = Math.max(0, items.length - ITEMS_VISIBLES)
  const itemsMostrados = expandido ? items : items.slice(0, ITEMS_VISIBLES)
  const descuento = venta.descuento ?? 0
  const saldoPendiente = venta.saldoPendiente ?? 0
  // Sin pagos registrados solo se infiere uno si la venta no quedó con saldo:
  // una venta fiada completa no tiene ningún pago que mostrar.
  const pagos: VentaExitoPago[] =
    venta.pagos && venta.pagos.length > 0
      ? venta.pagos
      : saldoPendiente > 0
        ? []
        : [{ metodoPago: venta.metodoPago, monto: venta.total }]
  // Para que las líneas del comprobante sumen al total (recargo, IVA aditivo, redondeo).
  const subtotal = typeof venta.subtotal === "number" ? venta.subtotal : null
  const ajuste = subtotal === null ? 0 : venta.total - (subtotal - descuento)
  const mostrarSubtotal = subtotal !== null && (descuento > 0 || Math.abs(ajuste) > 0.005)
  const cantGarantias = venta.garantias?.length ?? 0
  const comprobante = facturacion.comprobante

  // El foco entra al diálogo (no al botón primario: si el Enter del cobro
  // llegara repetido, activaría "Nueva venta" sin querer).
  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  // Enter no cierra durante los primeros instantes: el segundo Enter de un
  // doble toque en Cobrar, o el Enter final de un lector de código de barras,
  // cerraría el overlay antes de poder leer el vuelto.
  useEffect(() => {
    const montadoEn = Date.now()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.repeat || e.defaultPrevented) return
      if (Date.now() - montadoEn < GRACIA_ENTER_MS) return
      const target = e.target as Element | null
      if (target?.closest?.(INTERACTIVO)) return
      if (target?.closest?.("[data-radix-popper-content-wrapper]")) return
      // Cualquier otro diálogo (no este) se queda con su propio Enter.
      const dialogo = target?.closest?.("[role='dialog']")
      if (dialogo && dialogo !== dialogRef.current) return
      e.preventDefault()
      onClose()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [onClose])

  const hayEstados =
    cantGarantias > 0 || printer.connected || !!comprobante || !!facturacion.error

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="venta-exito-titulo"
      tabIndex={-1}
      className="fixed inset-0 z-[60] overflow-y-auto bg-background outline-none"
    >
      <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col justify-center px-4 pt-6 md:px-8 md:py-10">
        <div className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 duration-200 ease-snappy">
          <header className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-success/10 motion-safe:animate-in motion-safe:zoom-in-90 duration-200 ease-snappy">
              <Check className="h-6 w-6 text-success" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 id="venta-exito-titulo" className="text-xl font-bold leading-tight text-foreground md:text-2xl">
                Venta registrada
              </h2>
              <p className="truncate text-sm text-muted-foreground">
                Venta #{venta.numeroVenta}
                {" · "}
                {venta.clienteNombre || "Consumidor final"}
              </p>
            </div>
          </header>

          <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] md:content-start md:gap-x-8">
            {/* Héroe: vuelto en efectivo, total en el resto */}
            <div
              data-testid="venta-exito-hero"
              className="rounded-xl bg-success/10 px-5 py-4 md:col-start-2 md:row-start-1"
            >
              {cobro ? (
                <>
                  <p className="text-sm font-medium text-muted-foreground">Vuelto</p>
                  <p className="text-5xl font-bold tabular-nums leading-none text-success">
                    {formatPrice(cobro.vuelto)}
                  </p>
                  <p className="mt-2 text-sm tabular-nums text-muted-foreground">
                    Recibido {formatPrice(cobro.montoRecibido)} · Total {formatPrice(venta.total)}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-muted-foreground">Total</p>
                  <p className="text-5xl font-bold tabular-nums leading-none text-foreground">
                    {formatPrice(venta.total)}
                  </p>
                </>
              )}
            </div>

            {/* Comprobante compacto */}
            <section
              aria-label="Detalle de la venta"
              className="rounded-xl border bg-card p-4 text-card-foreground md:col-start-1 md:row-span-3 md:row-start-1"
            >
              <p className="text-sm font-semibold">{venta.clienteNombre || "Consumidor final"}</p>

              {items.length > 0 && (
                <ul className="mt-3 space-y-1.5 text-sm">
                  {itemsMostrados.map((item, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 break-words">
                        <span className="tabular-nums text-muted-foreground">{item.cantidad} ×</span>{" "}
                        {item.descripcion}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {formatPrice(item.subtotal ?? item.cantidad * item.precioUnitario)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {ocultos > 0 && (
                <button
                  type="button"
                  onClick={() => setExpandido((v) => !v)}
                  aria-expanded={expandido}
                  className="mt-2 inline-flex min-h-11 items-center gap-1 rounded-md text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-9"
                >
                  {expandido ? "Ver menos" : `y ${ocultos} más`}
                  <ChevronDown
                    className={cn("h-4 w-4 transition-transform duration-150", expandido && "rotate-180")}
                    aria-hidden="true"
                  />
                </button>
              )}

              <dl className="mt-3 space-y-1 border-t pt-3 text-sm">
                {mostrarSubtotal && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Subtotal</dt>
                    <dd className="tabular-nums">{formatPrice(subtotal!)}</dd>
                  </div>
                )}
                {descuento > 0 && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Descuento</dt>
                    <dd className="tabular-nums">-{formatPrice(descuento)}</dd>
                  </div>
                )}
                {Math.abs(ajuste) > 0.005 && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Recargos y ajustes</dt>
                    <dd className="tabular-nums">
                      {ajuste > 0 ? "+" : "-"}
                      {formatPrice(Math.abs(ajuste))}
                    </dd>
                  </div>
                )}
                {pagos.map((p, i) => (
                  <div key={i} className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{METODO_LABELS[p.metodoPago] || p.metodoPago}</dt>
                    <dd className="tabular-nums">{formatPrice(p.monto)}</dd>
                  </div>
                ))}
                {saldoPendiente > 0 && (
                  <div className="flex justify-between gap-3 font-medium text-warning">
                    <dt>Saldo pendiente</dt>
                    <dd className="tabular-nums">{formatPrice(saldoPendiente)}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-3 border-t pt-2 text-base font-semibold">
                  <dt>Total</dt>
                  <dd className="tabular-nums">{formatPrice(venta.total)}</dd>
                </div>
              </dl>
            </section>

            {/* Estados + acciones secundarias */}
            <div className="space-y-3 md:col-start-2 md:row-start-2">
              <ul
                aria-live="polite"
                className={cn("space-y-1.5 text-sm", !hayEstados && "hidden")}
              >
                {cantGarantias > 0 && (
                  <EstadoItem tono="ok">{textoGarantias(cantGarantias)}</EstadoItem>
                )}
                {printer.connected && (
                  printer.printing ? (
                    <EstadoItem tono="pendiente">Imprimiendo ticket…</EstadoItem>
                  ) : (
                    <EstadoItem tono="ok">Ticket impreso automáticamente</EstadoItem>
                  )
                )}
                {comprobante && (
                  <EstadoItem tono="ok">
                    Factura {comprobante.tipo} #{comprobante.numero}{" "}
                    {comprobante.yaEmitido ? "ya emitida" : "emitida"}
                    {comprobante.pdf_url && (
                      <>
                        {" · "}
                        <a
                          href={comprobante.pdf_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium underline underline-offset-2"
                        >
                          Ver factura
                        </a>
                      </>
                    )}
                  </EstadoItem>
                )}
                {facturacion.error && <EstadoItem tono="error">{facturacion.error}</EstadoItem>}
              </ul>

              <div className="grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-2">
                <Button variant="outline" className="h-11" onClick={onPrint} disabled={printer.printing}>
                  {printer.printing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Printer className="mr-2 h-4 w-4" />
                  )}
                  {printer.printing ? "Imprimiendo…" : printer.connected ? "Reimprimir" : "Imprimir"}
                </Button>
                {facturacion.disponible && (
                  <Button
                    variant="outline"
                    className="h-11"
                    onClick={facturacion.onEmitir}
                    disabled={facturacion.emitiendo || !!comprobante}
                  >
                    {facturacion.emitiendo ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <FileText className="mr-2 h-4 w-4" />
                    )}
                    {facturacion.emitiendo ? "Emitiendo…" : "Factura"}
                  </Button>
                )}
                <PosTicketShare
                  ventaData={venta as any}
                  plantillaCorta={plantillaCorta}
                  countryCode={countryCode}
                  buildManualWhatsAppUrl={(phone) => buildManualWhatsAppUrl(phone, venta)}
                />
              </div>
            </div>

            {/* Acción principal: abajo y fija en mobile, en la columna derecha en desktop */}
            <div className="sticky bottom-0 -mx-4 border-t bg-background px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 md:static md:col-start-2 md:row-start-3 md:mx-0 md:border-0 md:p-0">
              <Button onClick={onClose} className="h-14 w-full text-lg font-semibold">
                Nueva venta
                <kbd className="ml-3 hidden rounded border border-primary-foreground/30 px-1.5 py-0.5 font-mono text-[10px] font-normal opacity-80 md:inline">
                  Enter
                </kbd>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function EstadoItem({
  tono,
  children,
}: {
  tono: "ok" | "pendiente" | "error"
  children: React.ReactNode
}) {
  const Icono = tono === "ok" ? CheckCircle2 : tono === "error" ? AlertCircle : Loader2
  return (
    <li
      className={cn(
        "flex items-start gap-2",
        tono === "error" ? "text-destructive" : "text-foreground"
      )}
    >
      <Icono
        aria-hidden="true"
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          tono === "ok" && "text-success",
          tono === "pendiente" && "animate-spin text-muted-foreground"
        )}
      />
      <span className="min-w-0">{children}</span>
    </li>
  )
}
