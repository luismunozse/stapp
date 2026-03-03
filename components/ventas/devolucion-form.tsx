"use client"

import { useState, useMemo } from "react"
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

// --- Types ---

interface DevolucionFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  venta: {
    id: string
    numeroVenta: number
    items: Array<{
      id: string
      inventarioId: string | null
      descripcion: string
      cantidad: number
      precioUnitario: number
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

  // Track selection state for each item by its id
  const [itemStates, setItemStates] = useState<Record<string, ItemSelectionState>>(() =>
    buildInitialItemStates(venta.items)
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

  // Reset item states when the dialog opens with potentially new venta data
  const handleOpenChange = (value: boolean) => {
    if (value) {
      setItemStates(buildInitialItemStates(venta.items))
      reset({ motivo: "", observaciones: "" })
    }
    onOpenChange(value)
  }

  // Derived: selected items and total refund
  const selectedItems = useMemo(() => {
    return venta.items.filter((item) => itemStates[item.id]?.selected)
  }, [venta.items, itemStates])

  const totalReembolso = useMemo(() => {
    return selectedItems.reduce((sum, item) => {
      const state = itemStates[item.id]
      if (!state) return sum
      return sum + state.cantidad * item.precioUnitario
    }, 0)
  }, [selectedItems, itemStates])

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
    const item = venta.items.find((i) => i.id === itemId)
    if (!item) return
    const clamped = Math.max(1, Math.min(cantidad, item.cantidad))
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
    if (selectedItems.length === 0) {
      await showError("Selecciona al menos un producto para devolver")
      return
    }

    setLoading(true)
    try {
      const body = {
        motivo: data.motivo,
        observaciones: data.observaciones || undefined,
        items: selectedItems.map((item) => {
          const state = itemStates[item.id]
          return {
            itemVentaId: item.id,
            inventarioId: item.inventarioId,
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
      reset()
      setItemStates(buildInitialItemStates(venta.items))
      onOpenChange(false)
      onSuccess()
    } catch (error) {
      console.error("Error creating devolucion:", error)
      await showError("Error al registrar la devolución")
    } finally {
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
                        onChange={() => toggleItem(item.id)}
                        className="mt-1 h-4 w-4 rounded border-gray-300 accent-primary cursor-pointer"
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
                            max={item.cantidad}
                            value={state.cantidad}
                            onChange={(e) =>
                              updateCantidad(item.id, parseInt(e.target.value) || 1)
                            }
                            className="h-8"
                          />
                          <p className="text-[11px] text-muted-foreground">
                            Máximo: {item.cantidad}
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
                    <span>{formatPrice(state.cantidad * item.precioUnitario)}</span>
                  </div>
                )
              })}
              {selectedItems.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No hay productos seleccionados
                </p>
              )}
            </div>
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
  items: DevolucionFormProps["venta"]["items"]
): Record<string, ItemSelectionState> {
  const states: Record<string, ItemSelectionState> = {}
  for (const item of items) {
    states[item.id] = {
      selected: false,
      cantidad: item.cantidad,
      restaurarStock: item.inventarioId !== null,
    }
  }
  return states
}
