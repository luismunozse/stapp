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
import { formatCurrency } from "@/lib/utils"
import { Plus, Trash2, Package, Search } from "lucide-react"

const itemSchema = z.object({
  inventarioId: z.string().nullable().optional(),
  descripcion: z.string().min(1, "Descripción requerida"),
  cantidad: z.number().min(1, "Mínimo 1"),
  precioUnitario: z.number().min(0, "Precio inválido"),
  diasGarantia: z.number().min(0).default(0),
})

const ventaSchema = z.object({
  clienteId: z.string().nullable().optional(),
  clienteNombre: z.string().min(1, "Nombre del cliente requerido"),
  clienteTelefono: z.string().optional(),
  items: z.array(itemSchema).min(1, "Agrega al menos un producto"),
  descuento: z.number().min(0).default(0),
  metodoPago: z.enum(["EFECTIVO", "TRANSFERENCIA", "TARJETA"]),
  observaciones: z.string().optional(),
})

type VentaFormData = z.infer<typeof ventaSchema>

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

interface VentaFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function VentaForm({ open, onOpenChange, onSuccess }: VentaFormProps) {
  const { showError, showSuccess } = useModal()
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
  } = useForm<VentaFormData>({
    resolver: zodResolver(ventaSchema),
    defaultValues: {
      clienteId: null,
      clienteNombre: "",
      clienteTelefono: "",
      items: [{ inventarioId: null, descripcion: "", cantidad: 1, precioUnitario: 0, diasGarantia: 0 }],
      descuento: 0,
      metodoPago: "EFECTIVO",
      observaciones: "",
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

  // Cargar clientes
  useEffect(() => {
    const fetchClientes = async () => {
      try {
        const res = await fetch("/api/clientes")
        const data = await res.json()
        if (Array.isArray(data)) {
          setClientes(data)
        }
      } catch (error) {
        console.error("Error fetching clientes:", error)
      }
    }
    if (open) fetchClientes()
  }, [open])

  // Cargar inventario
  useEffect(() => {
    const fetchInventario = async () => {
      try {
        const res = await fetch("/api/inventario")
        const data = await res.json()
        if (Array.isArray(data)) {
          setInventario(data.filter((item: Inventario) => item.stock > 0))
        }
      } catch (error) {
        console.error("Error fetching inventario:", error)
      }
    }
    if (open) fetchInventario()
  }, [open])

  const filteredClientes = clientes.filter(
    (c) =>
      c.nombre.toLowerCase().includes(searchCliente.toLowerCase()) ||
      c.telefono.includes(searchCliente)
  )

  const filteredInventario = inventario.filter(
    (inv) =>
      inv.nombre.toLowerCase().includes(searchInventario.toLowerCase()) ||
      inv.codigo.toLowerCase().includes(searchInventario.toLowerCase())
  )

  const selectCliente = (cliente: Cliente) => {
    setValue("clienteId", cliente.id)
    setValue("clienteNombre", cliente.nombre)
    setValue("clienteTelefono", cliente.telefono)
    setShowClienteSearch(false)
    setSearchCliente("")
  }

  const selectInventarioItem = (index: number, inv: Inventario) => {
    setValue(`items.${index}.inventarioId`, inv.id)
    setValue(`items.${index}.descripcion`, inv.nombre)
    setValue(`items.${index}.precioUnitario`, inv.precioVenta)
  }

  const onSubmit = async (data: VentaFormData) => {
    setLoading(true)
    try {
      const res = await fetch("/api/ventas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })

      if (!res.ok) {
        const error = await res.json()
        await showError(error.error || "Error al crear la venta")
        return
      }

      await showSuccess("Venta registrada correctamente")
      reset()
      onSuccess()
    } catch (error) {
      console.error("Error creating venta:", error)
      await showError("Error al crear la venta")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nueva Venta</DialogTitle>
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
                      </div>
                      <div className="max-h-48 overflow-y-auto">
                        {filteredClientes.slice(0, 5).map((cliente) => (
                          <button
                            key={cliente.id}
                            type="button"
                            className="w-full px-4 py-2 text-left hover:bg-muted"
                            onClick={() => selectCliente(cliente)}
                          >
                            <div className="font-medium">{cliente.nombre}</div>
                            <div className="text-xs text-muted-foreground">{cliente.telefono}</div>
                          </button>
                        ))}
                        {filteredClientes.length === 0 && (
                          <div className="px-4 py-2 text-sm text-muted-foreground">
                            No se encontraron clientes
                          </div>
                        )}
                      </div>
                      <div className="border-t p-2">
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
                onClick={() => append({ inventarioId: null, descripcion: "", cantidad: 1, precioUnitario: 0, diasGarantia: 0 })}
              >
                <Plus className="mr-1 h-4 w-4" />
                Agregar
              </Button>
            </div>

            <div className="space-y-3">
              {fields.map((field, index) => (
                <div key={field.id} className="grid gap-3 rounded-lg bg-muted/50 p-3 sm:grid-cols-12">
                  {/* Descripción */}
                  <div className="sm:col-span-3">
                    <Label className="text-xs">Descripción</Label>
                    <div className="relative">
                      <Input
                        {...register(`items.${index}.descripcion`)}
                        placeholder="Producto"
                      />
                      {searchInventario && (
                        <div className="absolute z-10 mt-1 w-full rounded-md border bg-background shadow-lg">
                          <div className="max-h-32 overflow-y-auto">
                            {filteredInventario.slice(0, 5).map((inv) => (
                              <button
                                key={inv.id}
                                type="button"
                                className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                                onClick={() => {
                                  selectInventarioItem(index, inv)
                                  setSearchInventario("")
                                }}
                              >
                                <div className="flex justify-between">
                                  <span>{inv.nombre}</span>
                                  <span className="text-muted-foreground">Stock: {inv.stock}</span>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Inventario selector */}
                  <div className="sm:col-span-2">
                    <Label className="text-xs">Del Stock</Label>
                    <Select
                      value={watchItems[index]?.inventarioId || ""}
                      onChange={(e) => {
                        const inv = inventario.find((i) => i.id === e.target.value)
                        if (inv) {
                          selectInventarioItem(index, inv)
                        } else {
                          setValue(`items.${index}.inventarioId`, null)
                        }
                      }}
                    >
                      <option value="">Manual</option>
                      {inventario.map((inv) => (
                        <option key={inv.id} value={inv.id}>
                          {inv.codigo} ({inv.stock})
                        </option>
                      ))}
                    </Select>
                  </div>

                  {/* Cantidad */}
                  <div className="sm:col-span-2">
                    <Label className="text-xs">Cantidad</Label>
                    <Input
                      type="number"
                      min="1"
                      className="text-center"
                      {...register(`items.${index}.cantidad`, { valueAsNumber: true })}
                    />
                  </div>

                  {/* Precio */}
                  <div className="sm:col-span-2">
                    <Label className="text-xs">Precio</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      {...register(`items.${index}.precioUnitario`, { valueAsNumber: true })}
                    />
                  </div>

                  {/* Garantía */}
                  <div className="sm:col-span-2">
                    <Label className="text-xs">Garantía (días)</Label>
                    <Input
                      type="number"
                      min="0"
                      {...register(`items.${index}.diasGarantia`, { valueAsNumber: true })}
                      placeholder="0"
                    />
                  </div>

                  {/* Eliminar */}
                  <div className="flex items-end sm:col-span-1">
                    {fields.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => remove(index)}
                        className="text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {errors.items && (
              <p className="text-sm text-destructive">{errors.items.message}</p>
            )}
          </div>

          {/* Totales y Pago */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-4 rounded-lg border p-4">
              <h3 className="font-medium">Método de Pago</h3>
              <Select {...register("metodoPago")}>
                <option value="EFECTIVO">Efectivo</option>
                <option value="TRANSFERENCIA">Transferencia</option>
                <option value="TARJETA">Tarjeta</option>
              </Select>

              <div className="space-y-2">
                <Label>Descuento</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  {...register("descuento", { valueAsNumber: true })}
                />
              </div>

              <div className="space-y-2">
                <Label>Observaciones</Label>
                <Textarea
                  {...register("observaciones")}
                  placeholder="Notas adicionales..."
                  rows={2}
                />
              </div>
            </div>

            <div className="space-y-4 rounded-lg border bg-muted/50 p-4">
              <h3 className="font-medium">Resumen</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Subtotal:</span>
                  <span>{formatCurrency(subtotal)}</span>
                </div>
                {watchDescuento > 0 && (
                  <div className="flex justify-between text-sm text-destructive">
                    <span>Descuento:</span>
                    <span>-{formatCurrency(watchDescuento)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t pt-2 text-lg font-bold">
                  <span>Total:</span>
                  <span className="text-primary">{formatCurrency(total)}</span>
                </div>
              </div>

              <div className="text-xs text-muted-foreground">
                {watchItems.filter((i) => i.diasGarantia > 0).length > 0 && (
                  <p>
                    * Se generarán {watchItems.filter((i) => i.diasGarantia > 0).length} certificado(s) de garantía
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Guardando..." : "Registrar Venta"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
