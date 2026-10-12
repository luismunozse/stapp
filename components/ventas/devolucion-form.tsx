"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
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
import { Switch } from "@/components/ui/switch"
import { useModal } from "@/contexts/modal-context"
import { useCurrency } from "@/contexts/currency-context"
import { RotateCcw, Package, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { computeDevolucionMonto, effectivePaidUnitPrice, saleNetTotal } from "@/lib/devolucion-refund"

// --- Types ---

interface DevolucionFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  venta: {
    id: string
    numeroVenta: number
    /** Total efectivamente cobrado (con descuento global + IVA). */
    total: number
    /** Sin cliente no se puede devolver a cuenta corriente. */
    clienteId?: string | null
    /** Lo que el cliente todavía debe: la devolución lo descuenta primero. */
    saldoPendiente?: number
    /** Devoluciones anteriores: cantidades ya devueltas y lo ya reintegrado. */
    devoluciones?: Array<{
      montoDevolucion: number
      items: Array<{ itemVentaId: string; cantidad: number }>
    }>
    items: Array<{
      id: string
      inventarioId: string | null
      descripcion: string
      cantidad: number
      precioUnitario: number
      // Descuento de línea (opcional): permite estimar el reembolso neto real.
      descuento?: number
      tipoDescuento?: "MONTO" | "PORCENTAJE"
      porcentajeDescuento?: number
    }>
  }
  onSuccess: () => void
}

// --- Schema ---

const devolucionSchema = z.object({
  motivo: z.string().min(1, "El motivo es requerido"),
  observaciones: z.string().optional(),
})

type DevolucionFormData = z.infer<typeof devolucionSchema>

// --- Item selection state ---

interface ItemSelectionState {
  selected: boolean
  cantidad: number
  restaurarStock: boolean
  /** Unidades que todavía se pueden devolver (vendidas − ya devueltas). */
  disponible: number
}

// --- Component ---

export function DevolucionForm({
  open,
  onOpenChange,
  venta,
  onSuccess,
}: DevolucionFormProps) {
  const { showError, showSuccess } = useModal()
  const { formatPrice } = useCurrency()
  const [loading, setLoading] = useState(false)
  const [metodoReembolso, setMetodoReembolso] = useState<string>("")
  // Un pedido por apertura del diálogo: si el primer POST llegó y la
  // respuesta se perdió, el reintento no registra otra devolución.
  const [idempotencyKey, setIdempotencyKey] = useState("")
  // Guard de reentrada: el state `loading` llega tarde para un doble click.
  const submittingRef = useRef(false)

  const devueltas = useMemo(() => {
    const map: Record<string, number> = {}
    for (const d of venta.devoluciones ?? []) {
      for (const it of d.items) map[it.itemVentaId] = (map[it.itemVentaId] ?? 0) + it.cantidad
    }
    return map
  }, [venta.devoluciones])
  const yaReintegrado = useMemo(
    () => (venta.devoluciones ?? []).reduce((s, d) => s + (d.montoDevolucion || 0), 0),
    [venta.devoluciones]
  )

  // Track selection state for each item by its id
  const [itemStates, setItemStates] = useState<Record<string, ItemSelectionState>>(() =>
    buildInitialItemStates(venta.items, devueltas)
  )

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<DevolucionFormData>({
    resolver: zodResolver(devolucionSchema),
    defaultValues: {
      motivo: "",
      observaciones: "",
    },
  })

  // Al abrir se arranca de cero con los items actuales de la venta. El padre
  // abre el diálogo cambiando `open` (eso no dispara onOpenChange), así que
  // antes los estados quedaban armados con los items del primer render: tras
  // editar la venta (items con id nuevo) la lista salía vacía.
  // Solo en la transición cerrado → abierto: el padre arma `venta` en cada
  // render, y resetear con cada render borraría lo que el usuario va marcando.
  const wasOpen = useRef(false)
  useEffect(() => {
    const justOpened = open && !wasOpen.current
    wasOpen.current = open
    if (!justOpened) return
    setItemStates(buildInitialItemStates(venta.items, devueltas))
    reset({ motivo: "", observaciones: "" })
    setMetodoReembolso("")
    setIdempotencyKey(crypto.randomUUID())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleOpenChange = (value: boolean) => onOpenChange(value)

  // Derived: selected items and total refund
  const selectedItems = useMemo(() => {
    return venta.items.filter((item) => itemStates[item.id]?.selected)
  }, [venta.items, itemStates])

  // Items de la venta en el shape que espera la lógica de reembolso.
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
  const saleNet = useMemo(() => saleNetTotal(saleItems), [saleItems])
  const saleItemsById = useMemo(
    () => new Map(saleItems.map((it) => [it.id, it])),
    [saleItems]
  )

  // Precio pagado por unidad (neto de descuentos de línea + global + IVA), para
  // que el preview coincida con lo que realmente se reembolsa.
  const netUnitPrice = (itemId: string) => {
    const si = saleItemsById.get(itemId)
    return si ? effectivePaidUnitPrice(si, venta.total, saleNet) : 0
  }

  const totalDevolucion = useMemo(() => {
    const returned = selectedItems.map((item) => ({
      itemVentaId: item.id,
      cantidad: itemStates[item.id]?.cantidad ?? 0,
    }))
    // Igual que el servidor: tope en lo que queda por reintegrar y, si con
    // esto se devuelve todo, exactamente lo que queda.
    const esTotal = venta.items.every(
      (it) => (devueltas[it.id] ?? 0) + (itemStates[it.id]?.selected ? itemStates[it.id].cantidad : 0) >= it.cantidad
    )
    return computeDevolucionMonto(venta.total, saleItems, returned, {
      priorRefunded: yaReintegrado,
      isTotal: esTotal,
    })
  }, [selectedItems, itemStates, saleItems, venta.total, venta.items, devueltas, yaReintegrado])

  // Lo devuelto descuenta primero lo que el cliente todavía debe; solo el
  // resto se le reintegra (mig 330).
  const aplicadoDeuda = Math.min(totalDevolucion, Math.max(venta.saldoPendiente ?? 0, 0))
  const totalReembolso = Math.round((totalDevolucion - aplicadoDeuda) * 100) / 100

  // --- Handlers ---

  const toggleItem = (itemId: string) => {
    setItemStates((prev) => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        selected: !prev[itemId].selected,
      },
    }))
  }

  const updateCantidad = (itemId: string, cantidad: number) => {
    const disponible = itemStates[itemId]?.disponible ?? 0
    const clamped = Math.max(1, Math.min(cantidad, disponible))
    setItemStates((prev) => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        cantidad: clamped,
      },
    }))
  }

  const toggleRestaurarStock = (itemId: string) => {
    setItemStates((prev) => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        restaurarStock: !prev[itemId].restaurarStock,
      },
    }))
  }

  const onSubmit = async (data: DevolucionFormData) => {
    if (submittingRef.current) return
    if (selectedItems.length === 0) {
      await showError("Selecciona al menos un producto para devolver")
      return
    }

    submittingRef.current = true
    setLoading(true)
    try {
      const body = {
        motivo: data.motivo,
        observaciones: data.observaciones || undefined,
        metodoReembolso: (totalReembolso > 0 && metodoReembolso) || undefined,
        idempotencyKey: idempotencyKey || undefined,
        items: selectedItems.map((item) => {
          const state = itemStates[item.id]
          return {
            itemVentaId: item.id,
            cantidad: state.cantidad,
            precioUnitario: item.precioUnitario,
            restaurarStock: state.restaurarStock,
          }
        }),
      }

      const res = await fetch(`/api/ventas/${venta.id}/devolucion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const error = await res.json()
        await showError(error.error || "Error al registrar la devolución")
        return
      }

      await showSuccess("Devolución registrada correctamente")
      onOpenChange(false)
      onSuccess()
    } catch (error) {
      console.error("Error creating devolucion:", error)
      await showError("Error al registrar la devolución")
    } finally {
      submittingRef.current = false
      setLoading(false)
    }
  }

  const numeroFormateado = String(venta.numeroVenta).padStart(4, "0")

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5" />
            Devolución - Venta V{numeroFormateado}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Items de la venta */}
          <div className="space-y-4 rounded-lg border p-4">
            <h3 className="font-medium">Productos de la venta</h3>

            <div className="space-y-3">
              {venta.items.map((item) => {
                const state = itemStates[item.id]
                if (!state) return null

                return (
                  <div
                    key={item.id}
                    className={cn(
                      "rounded-lg border p-3 transition-colors",
                      state.selected
                        ? "border-primary bg-primary/5"
                        : "border-border bg-muted/30"
                    )}
                  >
                    {/* Row: checkbox + description + original info */}
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={state.selected}
                        disabled={state.disponible === 0}
                        onChange={() => toggleItem(item.id)}
                        aria-label={`Devolver ${item.descripcion}`}
                        className="mt-1 h-4 w-4 rounded border-gray-300 accent-primary cursor-pointer disabled:cursor-not-allowed"
                      />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="font-medium truncate">
                            {item.descripcion}
                          </span>
                        </div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          {item.cantidad} x {formatPrice(item.precioUnitario)}
                          {state.disponible < item.cantidad && (
                            <span className="ml-2 text-xs">
                              {state.disponible === 0
                                ? "· Ya devuelto"
                                : `· Ya devueltas: ${item.cantidad - state.disponible}`}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="text-right text-sm font-medium shrink-0">
                        {formatPrice(item.cantidad * item.precioUnitario)}
                      </div>
                    </div>

                    {/* Expanded options when selected */}
                    {state.selected && (
                      <div className="mt-3 ml-7 grid gap-4 sm:grid-cols-2">
                        {/* Cantidad a devolver */}
                        <div className="space-y-1">
                          <Label className="text-xs">Cantidad a devolver</Label>
                          <Input
                            type="number"
                            min={1}
                            max={state.disponible}
                            value={state.cantidad}
                            onChange={(e) =>
                              updateCantidad(item.id, parseInt(e.target.value) || 1)
                            }
                            className="h-8"
                          />
                          <p className="text-[11px] text-muted-foreground">
                            Máximo: {state.disponible}
                          </p>
                        </div>

                        {/* Restaurar stock */}
                        <div className="space-y-1">
                          <Label className="text-xs">Restaurar stock</Label>
                          <div className="flex items-center gap-2 pt-1">
                            <Switch
                              checked={state.restaurarStock}
                              onCheckedChange={() => toggleRestaurarStock(item.id)}
                              disabled={!item.inventarioId}
                            />
                            <span className="text-xs text-muted-foreground">
                              {!item.inventarioId
                                ? "Sin inventario asociado"
                                : state.restaurarStock
                                  ? "Se restaurará el stock"
                                  : "No se restaurará el stock"}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Motivo y Observaciones */}
          <div className="space-y-4 rounded-lg border p-4">
            <h3 className="font-medium">Detalles de la devolución</h3>

            <div className="space-y-2">
              <Label htmlFor="motivo">Motivo *</Label>
              <Input
                id="motivo"
                {...register("motivo")}
                placeholder="Ej: Producto defectuoso, error en la venta..."
              />
              {errors.motivo && (
                <p className="text-sm text-destructive">{errors.motivo.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="observaciones">Observaciones</Label>
              <Textarea
                id="observaciones"
                {...register("observaciones")}
                placeholder="Notas adicionales..."
                rows={3}
              />
            </div>

            {totalReembolso > 0 && (
              <div className="space-y-2">
                <Label htmlFor="metodoReembolso">Método de reembolso</Label>
                <select
                  id="metodoReembolso"
                  value={metodoReembolso}
                  onChange={(e) => setMetodoReembolso(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">Sin reembolso</option>
                  <option value="EFECTIVO">Efectivo</option>
                  <option value="TRANSFERENCIA">Transferencia</option>
                  <option value="TARJETA">Tarjeta</option>
                  {venta.clienteId && <option value="CUENTA_CORRIENTE">Saldo a favor en cuenta corriente</option>}
                  <option value="OTRO">Otro</option>
                </select>
              </div>
            )}
          </div>

          {/* Resumen */}
          <div className="rounded-lg border bg-muted/50 p-4 space-y-3">
            <h3 className="font-medium">Resumen</h3>
            <div className="space-y-1">
              {selectedItems.map((item) => {
                const state = itemStates[item.id]
                return (
                  <div
                    key={item.id}
                    className="flex justify-between text-sm"
                  >
                    <span className="text-muted-foreground">
                      {item.descripcion} x {state.cantidad}
                    </span>
                    <span>{formatPrice(state.cantidad * netUnitPrice(item.id))}</span>
                  </div>
                )
              })}
              {selectedItems.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No hay productos seleccionados
                </p>
              )}
            </div>
            {aplicadoDeuda > 0 && (
              <div className="space-y-1 border-t pt-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Valor de lo devuelto:</span>
                  <span>{formatPrice(totalDevolucion)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Se descuenta del saldo pendiente:</span>
                  <span>-{formatPrice(aplicadoDeuda)}</span>
                </div>
              </div>
            )}
            <div className="flex justify-between border-t pt-2 text-lg font-bold">
              <span>Total a reembolsar:</span>
              <span className="text-primary">{formatPrice(totalReembolso)}</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={loading || selectedItems.length === 0}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Procesando...
                </>
              ) : (
                <>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Registrar Devolución
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// --- Helpers ---

function buildInitialItemStates(
  items: DevolucionFormProps["venta"]["items"],
  devueltas: Record<string, number> = {}
): Record<string, ItemSelectionState> {
  const states: Record<string, ItemSelectionState> = {}
  for (const item of items) {
    const disponible = Math.max(item.cantidad - (devueltas[item.id] ?? 0), 0)
    states[item.id] = {
      selected: false,
      cantidad: disponible,
      restaurarStock: item.inventarioId !== null,
      disponible,
    }
  }
  return states
}
