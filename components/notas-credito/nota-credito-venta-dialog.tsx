"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, Loader2, Package } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { StatusBanner } from "@/components/ui/status-banner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useCurrency } from "@/contexts/currency-context"
import { useModal } from "@/contexts/modal-context"
import { computeDevolucionMonto } from "@/lib/devolucion-refund"
import { MOTIVOS_NC_VENTA, MOTIVO_NC_LABELS, type ModoNC, type MotivoNC } from "@/lib/notas-credito/catalogo"
import { disponibleParaAcreditar, repartoNC, round2 } from "@/lib/notas-credito/reparto"
import { cn } from "@/lib/utils"

export interface VentaParaNotaCredito {
  id: string
  numeroVenta: number
  /** Sucursal de la venta: el efectivo sale de su caja. */
  sucursalId: string | null
  /** Total facturado (con descuento global e IVA): el tope de lo que se acredita. */
  total: number
  /** Sin cliente no hay cuenta corriente. */
  clienteId: string | null
  /** Lo que el cliente todavía debe: la NC lo baja primero. */
  saldoPendiente: number
  /** NC anteriores de la venta; las anuladas no cuentan. */
  devoluciones: Array<{
    montoDevolucion: number
    anulada?: boolean
    items: Array<{ itemVentaId: string; cantidad: number }>
  }>
  items: Array<{
    id: string
    inventarioId: string | null
    descripcion: string
    cantidad: number
    precioUnitario: number
    descuento?: number
    tipoDescuento?: "MONTO" | "PORCENTAJE"
    porcentajeDescuento?: number
  }>
}

export interface NotaCreditoEmitida {
  id: string
  numero: string
}

export interface NotaCreditoVentaDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  venta: VentaParaNotaCredito
  /** Título del diálogo. El POS lo rotula "Devolución (nota de crédito)". */
  rotulo?: string
  onEmitida: (nc: NotaCreditoEmitida) => void
}

const MEDIOS: ReadonlyArray<{ value: string; label: string; requiereCliente?: boolean }> = [
  { value: "EFECTIVO", label: "Efectivo" },
  { value: "TRANSFERENCIA", label: "Transferencia" },
  { value: "TARJETA", label: "Tarjeta" },
  { value: "CUENTA_CORRIENTE", label: "Saldo a favor en cuenta corriente", requiereCliente: true },
  { value: "OTRO", label: "Otro" },
]

// <select> nativo, como DevolucionForm: el Select de Radix vacía el valor si se
// setea con el desplegable cerrado.
const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"

interface Linea {
  selected: boolean
  cantidad: number
  restaurarStock: boolean
  /** Unidades que todavía se pueden devolver (vendidas − ya devueltas). */
  disponible: number
}

function lineasIniciales(items: VentaParaNotaCredito["items"], devueltas: Record<string, number>): Record<string, Linea> {
  const out: Record<string, Linea> = {}
  for (const it of items) {
    const disponible = Math.max(it.cantidad - (devueltas[it.id] ?? 0), 0)
    out[it.id] = { selected: false, cantidad: disponible, restaurarStock: it.inventarioId !== null, disponible }
  }
  return out
}

function leerMonto(texto: string): number {
  const n = parseFloat(texto.replace(",", "."))
  return Number.isFinite(n) && n > 0 ? round2(n) : 0
}

/**
 * Emitir una nota de crédito sobre una venta: devolviendo productos (el monto
 * lo calcula el sistema, igual que la RPC) o por un monto. Muestra en vivo
 * cuánto baja la deuda y cuánto se le devuelve al cliente (spec, "Reglas de
 * plata"); la base decide y este cálculo solo lo anticipa. Lo usan el detalle
 * de la venta y el POS.
 */
export function NotaCreditoVentaDialog({
  open,
  onOpenChange,
  venta,
  rotulo = "Nota de crédito",
  onEmitida,
}: NotaCreditoVentaDialogProps) {
  const { showError } = useModal()
  const { formatPrice } = useCurrency()

  const activas = useMemo(() => venta.devoluciones.filter((d) => !d.anulada), [venta.devoluciones])
  const devueltas = useMemo(() => {
    const map: Record<string, number> = {}
    for (const d of activas) for (const it of d.items) map[it.itemVentaId] = (map[it.itemVentaId] ?? 0) + it.cantidad
    return map
  }, [activas])
  const acreditado = useMemo(() => activas.reduce((s, d) => s + (d.montoDevolucion || 0), 0), [activas])
  const disponible = disponibleParaAcreditar(venta.total, acreditado)
  const hayProductos = venta.items.some((it) => it.cantidad - (devueltas[it.id] ?? 0) > 0)

  const [modo, setModo] = useState<ModoNC>("ITEMS")
  const [lineas, setLineas] = useState<Record<string, Linea>>({})
  const [montoTexto, setMontoTexto] = useState("")
  const [motivoNc, setMotivoNc] = useState<MotivoNC | "">("")
  const [detalle, setDetalle] = useState("")
  const [medio, setMedio] = useState("")
  const [cajaAbierta, setCajaAbierta] = useState<boolean | null>(null)
  const [idempotencyKey, setIdempotencyKey] = useState("")
  const [enviando, setEnviando] = useState(false)
  // El state llega tarde para un doble click: la guarda es esta ref.
  const enviandoRef = useRef(false)

  // Arranca de cero cada vez que se abre (cerrado → abierto). El padre arma
  // `venta` en cada render: resetear en cada render borraría lo cargado.
  const estabaAbierto = useRef(false)
  useEffect(() => {
    const recienAbierto = open && !estabaAbierto.current
    estabaAbierto.current = open
    if (!recienAbierto) return
    const modoInicial: ModoNC = hayProductos ? "ITEMS" : "MONTO"
    setModo(modoInicial)
    setLineas(lineasIniciales(venta.items, devueltas))
    setMontoTexto("")
    setMotivoNc(modoInicial === "ITEMS" ? "DEVOLUCION" : "")
    setDetalle("")
    setMedio("")
    setCajaAbierta(null)
    // Un pedido por apertura: si la respuesta se pierde, el reintento no emite otra NC.
    setIdempotencyKey(crypto.randomUUID())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const saleItems = useMemo(
    () =>
      venta.items.map((it) => ({
        id: it.id,
        cantidad: it.cantidad,
        precio_unitario: it.precioUnitario,
        descuento: it.descuento ?? 0,
        tipo_descuento: it.tipoDescuento ?? "MONTO",
        porcentaje_descuento: it.porcentajeDescuento ?? 0,
      })),
    [venta.items]
  )

  const seleccionados = venta.items.filter((it) => lineas[it.id]?.selected)
  const devueltosAhora = seleccionados.map((it) => ({ itemVentaId: it.id, cantidad: lineas[it.id].cantidad }))
  // Igual que la RPC: si con esto vuelve todo, se acredita exactamente lo que queda.
  const vuelveTodo = venta.items.every(
    (it) => (devueltas[it.id] ?? 0) + (lineas[it.id]?.selected ? lineas[it.id].cantidad : 0) >= it.cantidad
  )
  const montoProductos =
    devueltosAhora.length === 0
      ? 0
      : computeDevolucionMonto(venta.total, saleItems, devueltosAhora, { priorRefunded: acreditado, isTotal: vuelveTodo })
  const montoIngresado = leerMonto(montoTexto)
  const monto = modo === "ITEMS" ? montoProductos : montoIngresado
  const { aplicado, reembolso, pendienteResultante } = repartoNC(monto, venta.saldoPendiente)

  const problema = ((): string | null => {
    if (disponible <= 0) return "Esta venta ya no tiene saldo para acreditar."
    if (modo === "ITEMS" && seleccionados.length === 0) return "Elegí al menos un producto."
    if (modo === "MONTO" && montoIngresado <= 0) return "Cargá el monto a acreditar."
    if (modo === "MONTO" && montoIngresado > disponible) return `El monto no puede superar ${formatPrice(disponible)}.`
    if (!motivoNc) return "Elegí el motivo."
    if (reembolso > 0 && !medio) return "Elegí cómo se le devuelve la plata."
    return null
  })()

  // Efectivo: ¿hay caja abierta en la sucursal de la venta? Solo se avisa; el
  // egreso se registra igual (spec, Decisiones de producto).
  const consultarCaja = open && medio === "EFECTIVO" && reembolso > 0 && cajaAbierta === null
  useEffect(() => {
    if (!consultarCaja) return
    let cancelado = false
    const sucursal = venta.sucursalId ? `&sucursalId=${encodeURIComponent(venta.sucursalId)}` : ""
    fetch(`/api/caja/sesiones?current=true${sucursal}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelado && data) setCajaAbierta(Boolean(data.sesion))
      })
      .catch(() => {})
    return () => {
      cancelado = true
    }
  }, [consultarCaja, venta.sucursalId])

  const cambiarModo = (m: ModoNC) => {
    setModo(m)
    // El motivo por defecto de cada modo; uno elegido a mano se respeta.
    if (m === "ITEMS" && motivoNc === "") setMotivoNc("DEVOLUCION")
    if (m === "MONTO" && motivoNc === "DEVOLUCION") setMotivoNc("")
  }

  const cambiarLinea = (id: string, cambio: Partial<Linea>) =>
    setLineas((prev) => ({ ...prev, [id]: { ...prev[id], ...cambio } }))

  const emitir = async () => {
    if (enviandoRef.current || problema) return
    enviandoRef.current = true
    setEnviando(true)
    try {
      const comun = {
        motivoNc,
        motivo: detalle.trim() || undefined,
        metodoReembolso: reembolso > 0 ? medio : undefined,
        idempotencyKey,
      }
      const body =
        modo === "ITEMS"
          ? {
              ...comun,
              modo,
              items: seleccionados.map((it) => ({
                itemVentaId: it.id,
                cantidad: lineas[it.id].cantidad,
                precioUnitario: round2(it.precioUnitario),
                restaurarStock: lineas[it.id].restaurarStock,
              })),
            }
          : { ...comun, modo, monto: round2(montoIngresado) }

      const res = await fetch(`/api/ventas/${venta.id}/devolucion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        await showError(json.error || "No se pudo emitir la nota de crédito")
        return
      }
      toast.success(`Nota de crédito ${json.numeroDevolucion} emitida`)
      onOpenChange(false)
      onEmitida({ id: json.id, numero: json.numeroDevolucion })
    } catch {
      await showError("No se pudo emitir la nota de crédito")
    } finally {
      enviandoRef.current = false
      setEnviando(false)
    }
  }

  const numero = String(venta.numeroVenta).padStart(4, "0")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {rotulo} · Venta V{numero}
          </DialogTitle>
          <DialogDescription>Disponible para acreditar: {formatPrice(disponible)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div role="group" aria-label="Cómo se acredita" className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={modo === "ITEMS" ? "default" : "outline"}
              aria-pressed={modo === "ITEMS"}
              disabled={!hayProductos}
              onClick={() => cambiarModo("ITEMS")}
            >
              Devolver productos
            </Button>
            <Button
              type="button"
              variant={modo === "MONTO" ? "default" : "outline"}
              aria-pressed={modo === "MONTO"}
              onClick={() => cambiarModo("MONTO")}
            >
              Por monto
            </Button>
          </div>

          {modo === "ITEMS" ? (
            <div className="space-y-3">
              {venta.items.map((item) => {
                const linea = lineas[item.id]
                if (!linea) return null
                return (
                  <div
                    key={item.id}
                    className={cn(
                      "rounded-lg border p-3 transition-colors",
                      linea.selected ? "border-primary bg-primary/5" : "border-border bg-muted/30"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={linea.selected}
                        disabled={linea.disponible === 0}
                        onChange={() => cambiarLinea(item.id, { selected: !linea.selected })}
                        aria-label={`Devolver ${item.descripcion}`}
                        className="mt-1 h-4 w-4 cursor-pointer rounded border-gray-300 accent-primary disabled:cursor-not-allowed"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="truncate font-medium">{item.descripcion}</span>
                        </div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          {item.cantidad} x {formatPrice(item.precioUnitario)}
                          {linea.disponible < item.cantidad ? (
                            <span className="ml-2 text-xs">
                              {linea.disponible === 0 ? "· Ya devuelto" : `· Ya devueltas: ${item.cantidad - linea.disponible}`}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {linea.selected ? (
                      <div className="ml-7 mt-3 grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label htmlFor={`nc-cantidad-${item.id}`} className="text-xs">
                            Cantidad a devolver
                          </Label>
                          <Input
                            id={`nc-cantidad-${item.id}`}
                            type="number"
                            min={1}
                            max={linea.disponible}
                            value={linea.cantidad}
                            onChange={(e) =>
                              cambiarLinea(item.id, {
                                cantidad: Math.max(1, Math.min(parseInt(e.target.value) || 1, linea.disponible)),
                              })
                            }
                            className="h-8"
                          />
                          <p className="text-[11px] text-muted-foreground">Máximo: {linea.disponible}</p>
                        </div>
                        <div className="space-y-1">
                          <span className="text-xs font-medium">Vuelve al stock</span>
                          <div className="flex items-center gap-2 pt-1">
                            <Switch
                              checked={linea.restaurarStock}
                              onCheckedChange={() => cambiarLinea(item.id, { restaurarStock: !linea.restaurarStock })}
                              disabled={!item.inventarioId}
                              aria-label={`Reponer stock de ${item.descripcion}`}
                            />
                            <span className="text-xs text-muted-foreground">
                              {!item.inventarioId
                                ? "Sin producto de inventario"
                                : linea.restaurarStock
                                  ? "Se repone el stock"
                                  : "No se repone (roto o descartado)"}
                            </span>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="nc-monto">Monto a acreditar</Label>
              <Input
                id="nc-monto"
                type="number"
                inputMode="decimal"
                min={0}
                max={disponible}
                step="0.01"
                value={montoTexto}
                onChange={(e) => setMontoTexto(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Para un cobro de más, una bonificación o un error de precio. No toca el stock.
              </p>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="nc-motivo">Motivo</Label>
              <select
                id="nc-motivo"
                value={motivoNc}
                onChange={(e) => setMotivoNc(e.target.value as MotivoNC | "")}
                className={SELECT_CLASS}
              >
                <option value="">Elegí el motivo</option>
                {MOTIVOS_NC_VENTA.map((m) => (
                  <option key={m} value={m}>
                    {MOTIVO_NC_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="nc-detalle">Detalle (opcional)</Label>
              <Textarea
                id="nc-detalle"
                rows={2}
                maxLength={500}
                value={detalle}
                onChange={(e) => setDetalle(e.target.value)}
                placeholder="Ej: le cobramos dos veces el cable"
              />
            </div>
          </div>

          {reembolso > 0 ? (
            <div className="space-y-2">
              <Label htmlFor="nc-medio">Cómo se le devuelve</Label>
              <select id="nc-medio" value={medio} onChange={(e) => setMedio(e.target.value)} className={SELECT_CLASS}>
                <option value="">Elegí cómo</option>
                {MEDIOS.filter((m) => !m.requiereCliente || venta.clienteId).map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              {medio === "EFECTIVO" && cajaAbierta === false ? (
                <StatusBanner tone="warning" icon={AlertTriangle}>
                  No hay caja abierta en esta sucursal: la salida de efectivo se registra igual, pero no entra en ningún arqueo.
                </StatusBanner>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-1 rounded-lg border bg-muted/50 p-4 text-sm">
            <FilaResumen etiqueta="Se acredita" valor={formatPrice(monto)} destacada />
            {aplicado > 0 ? <FilaResumen etiqueta="Baja la deuda de la venta" valor={formatPrice(aplicado)} /> : null}
            {reembolso > 0 ? <FilaResumen etiqueta="Se le devuelve" valor={formatPrice(reembolso)} /> : null}
            <FilaResumen etiqueta="Saldo pendiente después" valor={formatPrice(pendienteResultante)} />
          </div>

          {problema ? <p className="text-sm text-muted-foreground">{problema}</p> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={emitir} disabled={enviando || problema !== null}>
              {enviando ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Emitiendo...
                </>
              ) : (
                "Emitir nota de crédito"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function FilaResumen({ etiqueta, valor, destacada = false }: { etiqueta: string; valor: string; destacada?: boolean }) {
  return (
    <div className={cn("flex justify-between", destacada && "text-base font-semibold")}>
      <span className={destacada ? undefined : "text-muted-foreground"}>{etiqueta}</span>
      <span>{valor}</span>
    </div>
  )
}
