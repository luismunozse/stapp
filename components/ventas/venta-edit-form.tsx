"use client"

import { useState, useEffect } from "react"
import { useForm, useFieldArray } from "react-hook-form"
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
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useModal } from "@/contexts/modal-context"
import { Plus, Trash2, Package, Search, Loader2 } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"

const itemSchema = z.object({
  id: z.string().optional(), // Para items existentes
  inventarioId: z.string().nullable().optional(),
  descripcion: z.string().min(1, "Descripción requerida"),
  cantidad: z.number().min(1, "Mínimo 1"),
  precioUnitario: z.number().min(0, "Precio inválido"),
  diasGarantia: z.number().min(0).default(0),
})

const ventaEditSchema = z.object({
  clienteId: z.string().nullable().optional(),
  clienteNombre: z.string().min(1, "Nombre del cliente requerido"),
  clienteTelefono: z.string().optional(),
  items: z.array(itemSchema).min(1, "Agrega al menos un producto"),
  descuento: z.number().min(0).default(0),
  metodoPago: z.enum(["EFECTIVO", "TRANSFERENCIA", "TARJETA", "TARJETA_DEBITO", "TARJETA_CREDITO", "MERCADOPAGO", "OTRO"]),
  observaciones: z.string().optional(),
})

type VentaEditFormData = z.infer<typeof ventaEditSchema>

interface Cliente {
  id: string
  nombre: string
  telefono: string
}

interface Inventario {
  id: string
  codigo: string
  nombre: string
  stock: number
  precioVenta: number
}

interface VentaItem {
  id: string
  inventarioId: string | null
  descripcion: string
  cantidad: number
  precioUnitario: number
  diasGarantia: number
}

interface VentaData {
  id: string
  numeroVenta: number
  clienteId: string | null
  clienteNombre: string
  clienteTelefono: string | null
  items: VentaItem[]
  descuento: number
  metodoPago: string
  observaciones: string | null
}

interface VentaEditFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  venta: VentaData
  onSuccess: () => void
}

export function VentaEditForm({ open, onOpenChange, venta, onSuccess }: VentaEditFormProps) {
  const { showError, showSuccess } = useModal()
  const { formatPrice } = useCurrency()
  const [loading, setLoading] = useState(false)
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [inventario, setInventario] = useState<Inventario[]>([])
  const [searchCliente, setSearchCliente] = useState("")
  const [searchInventario, setSearchInventario] = useState("")
  const [showClienteSearch, setShowClienteSearch] = useState(false)

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<VentaEditFormData>({
    resolver: zodResolver(ventaEditSchema),
    defaultValues: {
      clienteId: venta.clienteId,
      clienteNombre: venta.clienteNombre,
      clienteTelefono: venta.clienteTelefono || "",
      items: venta.items.map(item => ({
        id: item.id,
        inventarioId: item.inventarioId,
        descripcion: item.descripcion,
        cantidad: item.cantidad,
        precioUnitario: item.precioUnitario,
        diasGarantia: item.diasGarantia,
      })),
      descuento: venta.descuento,
      metodoPago: venta.metodoPago as VentaEditFormData["metodoPago"],
      observaciones: venta.observaciones || "",
    },
  })

  const { fields, append, remove } = useFieldArray({
    control,
    name: "items",
  })

  const watchItems = watch("items")
  const watchDescuento = watch("descuento") || 0

  const subtotal = watchItems.reduce(
    (sum, item) => sum + (item.cantidad || 0) * (item.precioUnitario || 0),
    0
  )
  const total = subtotal - watchDescuento

  useEffect(() => {
    if (open) {
      fetchClientes()
      fetchInventario()
      // Reset form con datos de la venta
      reset({
        clienteId: venta.clienteId,
        clienteNombre: venta.clienteNombre,
        clienteTelefono: venta.clienteTelefono || "",
        items: venta.items.map(item => ({
          id: item.id,
          inventarioId: item.inventarioId,
          descripcion: item.descripcion,
          cantidad: item.cantidad,
          precioUnitario: item.precioUnitario,
          diasGarantia: item.diasGarantia,
        })),
        descuento: venta.descuento,
        metodoPago: venta.metodoPago as VentaEditFormData["metodoPago"],
        observaciones: venta.observaciones || "",
      })
    }
  }, [open, venta, reset])

  const fetchClientes = async () => {
    try {
      const res = await fetch("/api/clientes?limit=100")
      if (res.ok) {
        const data = await res.json()
        setClientes(data.clientes || [])
      }
    } catch (error) {
      console.error("Error fetching clientes:", error)
    }
  }

  const fetchInventario = async (query = "") => {
    try {
      const params = new URLSearchParams({ q: query, limit: "20" })
      const res = await fetch(`/api/inventario/search?${params}`)
      if (res.ok) {
        const data = await res.json()
        setInventario(Array.isArray(data) ? data : [])
      }
    } catch (error) {
      console.error("Error fetching inventario:", error)
    }
  }

  const selectCliente = (cliente: Cliente) => {
    setValue("clienteId", cliente.id)
    setValue("clienteNombre", cliente.nombre)
    setValue("clienteTelefono", cliente.telefono)
    setShowClienteSearch(false)
  }

  const selectInventarioItem = (index: number, inv: Inventario) => {
    setValue(`items.${index}.inventarioId`, inv.id)
    setValue(`items.${index}.descripcion`, inv.nombre)
    setValue(`items.${index}.precioUnitario`, inv.precioVenta)
  }

  const onSubmit = async (data: VentaEditFormData) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/ventas/${venta.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          action: "edit", // Para distinguir de anulación
        }),
      })

      if (!res.ok) {
        const error = await res.json()
        await showError(error.error || "Error al actualizar la venta")
        return
      }

      await showSuccess("Venta actualizada correctamente")
      onOpenChange(false)
      onSuccess()
    } catch (error) {
      console.error("Error updating venta:", error)
      await showError("Error al actualizar la venta")
    } finally {
      setLoading(false)
    }
  }

  const filteredClientes = clientes.filter(
    (c) =>
      c.nombre.toLowerCase().includes(searchCliente.toLowerCase()) ||
      c.telefono.includes(searchCliente)
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-1rem)] sm:max-w-3xl max-h-[90dvh] overflow-y-auto pb-[env(safe-area-inset-bottom,1rem)]">
        <DialogHeader>
          <DialogTitle>
            Editar Venta V{String(venta.numeroVenta).padStart(4, "0")}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Cliente */}
          <div className="space-y-4 rounded-lg border p-4">
            <h3 className="font-medium">Datos del Cliente</h3>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Nombre del Cliente *</Label>
                <div className="relative">
                  <Input
                    {...register("clienteNombre")}
                    placeholder="Nombre del cliente"
                    onFocus={() => setShowClienteSearch(true)}
                  />
                  {showClienteSearch && (
                    <div className="absolute z-10 mt-1 w-full rounded-md border bg-background shadow-lg">
                      <div className="p-2">
                        <div className="relative">
                          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            placeholder="Buscar cliente..."
                            className="pl-8"
                            value={searchCliente}
                            onChange={(e) => setSearchCliente(e.target.value)}
                            autoFocus
                          />
                        </div>
                        <div className="mt-2 max-h-40 overflow-y-auto">
                          {filteredClientes.slice(0, 5).map((cliente) => (
                            <button
                              key={cliente.id}
                              type="button"
                              className="w-full rounded p-2 text-left text-sm hover:bg-muted"
                              onClick={() => selectCliente(cliente)}
                            >
                              <div className="font-medium">{cliente.nombre}</div>
                              <div className="text-xs text-muted-foreground">
                                {cliente.telefono}
                              </div>
                            </button>
                          ))}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="w-full"
                          onClick={() => setShowClienteSearch(false)}
                        >
                          Cerrar
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
                {errors.clienteNombre && (
                  <p className="text-sm text-destructive">{errors.clienteNombre.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Teléfono</Label>
                <Input {...register("clienteTelefono")} placeholder="Teléfono" />
              </div>
            </div>
          </div>

          {/* Items */}
          <div className="space-y-4 rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">Productos</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  append({
                    inventarioId: null,
                    descripcion: "",
                    cantidad: 1,
                    precioUnitario: 0,
                    diasGarantia: 0,
                  })
                }
              >
                <Plus className="mr-1 h-4 w-4" />
                Agregar
              </Button>
            </div>

            {fields.map((field, index) => (
              <div key={field.id} className="space-y-3 rounded border bg-muted/30 p-3">
                <div className="flex items-start gap-2">
                  <div className="flex-1 space-y-2">
                    <Label>Producto *</Label>
                    <div className="relative">
                      <Input
                        {...register(`items.${index}.descripcion`)}
                        placeholder="Descripción del producto"
                      />
                      {searchInventario && (
                        <div className="absolute z-10 mt-1 w-full rounded-md border bg-background shadow-lg">
                          <div className="max-h-40 overflow-y-auto p-2">
                            {inventario
                              .filter(
                                (inv) =>
                                  inv.nombre
                                    .toLowerCase()
                                    .includes(searchInventario.toLowerCase()) ||
                                  inv.codigo
                                    .toLowerCase()
                                    .includes(searchInventario.toLowerCase())
                              )
                              .slice(0, 5)
                              .map((inv) => (
                                <button
                                  key={inv.id}
                                  type="button"
                                  className="w-full rounded p-2 text-left text-sm hover:bg-muted"
                                  onClick={() => {
                                    selectInventarioItem(index, inv)
                                    setSearchInventario("")
                                  }}
                                >
                                  <div className="flex justify-between">
                                    <span className="font-medium">{inv.nombre}</span>
                                    <span className="text-muted-foreground">
                                      Stock: {inv.stock}
                                    </span>
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {inv.codigo} - {formatPrice(inv.precioVenta)}
                                  </div>
                                </button>
                              ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  {fields.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="mt-8 text-destructive"
                      onClick={() => remove(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="space-y-1">
                    <Label className="text-xs">Cantidad</Label>
                    <Input
                      type="number"
                      min="1"
                      {...register(`items.${index}.cantidad`, { valueAsNumber: true })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Precio Unit.</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      {...register(`items.${index}.precioUnitario`, { valueAsNumber: true })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Garantía (días)</Label>
                    <Input
                      type="number"
                      min="0"
                      {...register(`items.${index}.diasGarantia`, { valueAsNumber: true })}
                    />
                  </div>
                  <div className="flex items-end">
                    <div className="w-full rounded bg-muted px-3 py-2 text-right font-medium">
                      {formatPrice(
                        (watchItems[index]?.cantidad || 0) *
                          (watchItems[index]?.precioUnitario || 0)
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {errors.items && (
              <p className="text-sm text-destructive">
                {errors.items.message || "Revisa los productos"}
              </p>
            )}
          </div>

          {/* Totales y pago */}
          <div className="space-y-4 rounded-lg border p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Método de Pago *</Label>
                <Select {...register("metodoPago")}>
                  <option value="EFECTIVO">Efectivo</option>
                  <option value="TRANSFERENCIA">Transferencia</option>
                  <option value="TARJETA">Tarjeta</option>
                  <option value="TARJETA_DEBITO">Tarjeta Débito</option>
                  <option value="TARJETA_CREDITO">Tarjeta Crédito</option>
                  <option value="MERCADOPAGO">MercadoPago</option>
                  <option value="OTRO">Otro</option>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Descuento</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  {...register("descuento", { valueAsNumber: true })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Observaciones</Label>
              <Textarea
                {...register("observaciones")}
                placeholder="Notas adicionales..."
                rows={2}
              />
            </div>

            {/* Resumen */}
            <div className="rounded-lg bg-muted p-4">
              <div className="flex justify-between text-sm">
                <span>Subtotal:</span>
                <span>{formatPrice(subtotal)}</span>
              </div>
              {watchDescuento > 0 && (
                <div className="flex justify-between text-sm text-destructive">
                  <span>Descuento:</span>
                  <span>-{formatPrice(watchDescuento)}</span>
                </div>
              )}
              <div className="mt-2 flex justify-between border-t pt-2 text-lg font-bold">
                <span>Total:</span>
                <span className="text-primary">{formatPrice(total)}</span>
              </div>
            </div>
          </div>

          {/* Botones */}
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Guardando...
                </>
              ) : (
                "Guardar Cambios"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
