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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useModal } from "@/contexts/modal-context"
import { formatCurrency } from "@/lib/utils"
import { Plus, Trash2, Package, Search, Loader2 } from "lucide-react"

const clienteSchema = z.object({
  nombre: z.string()
    .min(1, "El nombre es requerido")
    .regex(/^[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ\s]+$/, "El nombre solo debe contener letras"),
  telefono: z.string()
    .min(1, "El teléfono es requerido")
    .regex(/^\d{10}$/, "El teléfono debe tener exactamente 10 dígitos"),
  email: z.string().email("Email inválido").optional().or(z.literal("")),
  direccion: z.string().optional(),
  dni: z.string()
    .regex(/^(\d{7,8})?$/, "El DNI debe tener 7 u 8 dígitos")
    .optional()
    .or(z.literal("")),
})

type ClienteFormData = z.infer<typeof clienteSchema>

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

export interface VentaCreadaData {
  id: string
  numeroVenta: number
  clienteNombre: string
  clienteTelefono: string | null
  items: Array<{
    descripcion: string
    cantidad: number
    precioUnitario: number
    diasGarantia: number
  }>
  subtotal: number
  descuento: number
  total: number
  metodoPago: string
  garantias: Array<{
    id: string
    numeroGarantia: number
    diasValidez: number
  }>
  organizationName?: string
}

interface VentaFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: (venta: VentaCreadaData) => void
}

export function VentaForm({ open, onOpenChange, onSuccess }: VentaFormProps) {
  const { showError } = useModal()
  const [loading, setLoading] = useState(false)
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [inventario, setInventario] = useState<Inventario[]>([])
  const [searchCliente, setSearchCliente] = useState("")
  const [searchInventario, setSearchInventario] = useState("")
  const [showClienteSearch, setShowClienteSearch] = useState(false)
  const [showClienteModal, setShowClienteModal] = useState(false)
  const [clienteLoading, setClienteLoading] = useState(false)

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

  const clienteForm = useForm<ClienteFormData>({
    resolver: zodResolver(clienteSchema),
    defaultValues: {
      nombre: "",
      telefono: "",
      email: "",
      direccion: "",
      dni: "",
    },
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

  const handleCreateCliente = async (data: ClienteFormData) => {
    setClienteLoading(true)
    try {
      const res = await fetch("/api/clientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })

      if (!res.ok) {
        const error = await res.json()
        await showError(error.error || "Error al crear cliente")
        return
      }

      const nuevoCliente = await res.json()

      // Agregar el nuevo cliente a la lista y seleccionarlo
      setClientes(prev => [...prev, nuevoCliente])
      setValue("clienteId", nuevoCliente.id)
      setValue("clienteNombre", nuevoCliente.nombre)
      setValue("clienteTelefono", nuevoCliente.telefono)

      // Cerrar modal y resetear formulario
      setShowClienteModal(false)
      clienteForm.reset()
    } catch (error) {
      console.error("Error creating cliente:", error)
      await showError("Error al crear cliente")
    } finally {
      setClienteLoading(false)
    }
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

      const ventaData = await res.json()

      // Preparar datos para el callback
      const ventaCreada: VentaCreadaData = {
        id: ventaData.id,
        numeroVenta: ventaData.numeroVenta,
        clienteNombre: ventaData.clienteNombre,
        clienteTelefono: ventaData.clienteTelefono,
        items: ventaData.items,
        subtotal: ventaData.subtotal,
        descuento: ventaData.descuento,
        total: ventaData.total,
        metodoPago: ventaData.metodoPago,
        garantias: ventaData.garantias,
      }

      reset()
      onOpenChange(false)
      onSuccess(ventaCreada)
    } catch (error) {
      console.error("Error creating venta:", error)
      await showError("Error al crear la venta")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
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
                <div className="flex gap-2">
                  <div className="relative flex-1">
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
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setShowClienteModal(true)}
                    title="Crear nuevo cliente"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
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
                      value={watchItems[index]?.inventarioId || "manual"}
                      onValueChange={(value) => {
                        const inv = inventario.find((i) => i.id === value)
                        if (inv) {
                          selectInventarioItem(index, inv)
                        } else {
                          setValue(`items.${index}.inventarioId`, null)
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Manual" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manual">Manual</SelectItem>
                        {inventario.map((inv) => (
                          <SelectItem key={inv.id} value={inv.id}>
                            {inv.codigo} ({inv.stock})
                          </SelectItem>
                        ))}
                      </SelectContent>
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
              <Select
                value={watch("metodoPago")}
                onValueChange={(value) => setValue("metodoPago", value as "EFECTIVO" | "TRANSFERENCIA" | "TARJETA")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EFECTIVO">Efectivo</SelectItem>
                  <SelectItem value="TRANSFERENCIA">Transferencia</SelectItem>
                  <SelectItem value="TARJETA">Tarjeta</SelectItem>
                </SelectContent>
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

        {/* Modal para crear nuevo cliente */}
        <Dialog open={showClienteModal} onOpenChange={setShowClienteModal}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nuevo Cliente</DialogTitle>
            </DialogHeader>
            <form onSubmit={clienteForm.handleSubmit(handleCreateCliente)} className="space-y-4">
              <div>
                <Label htmlFor="cliente-nombre">Nombre *</Label>
                <Input
                  id="cliente-nombre"
                  {...clienteForm.register("nombre")}
                  placeholder="Nombre completo"
                />
                {clienteForm.formState.errors.nombre && (
                  <p className="text-sm text-destructive mt-1">
                    {clienteForm.formState.errors.nombre.message}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="cliente-telefono">Teléfono *</Label>
                <Input
                  id="cliente-telefono"
                  {...clienteForm.register("telefono")}
                  placeholder="1123456789"
                  maxLength={10}
                />
                {clienteForm.formState.errors.telefono && (
                  <p className="text-sm text-destructive mt-1">
                    {clienteForm.formState.errors.telefono.message}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="cliente-email">Email</Label>
                <Input
                  id="cliente-email"
                  type="email"
                  {...clienteForm.register("email")}
                  placeholder="cliente@email.com"
                />
                {clienteForm.formState.errors.email && (
                  <p className="text-sm text-destructive mt-1">
                    {clienteForm.formState.errors.email.message}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="cliente-dni">DNI</Label>
                <Input
                  id="cliente-dni"
                  {...clienteForm.register("dni")}
                  placeholder="12345678"
                  maxLength={8}
                />
                {clienteForm.formState.errors.dni && (
                  <p className="text-sm text-destructive mt-1">
                    {clienteForm.formState.errors.dni.message}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="cliente-direccion">Dirección</Label>
                <Input
                  id="cliente-direccion"
                  {...clienteForm.register("direccion")}
                  placeholder="Dirección completa"
                />
              </div>

              <div className="flex gap-2 justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowClienteModal(false)
                    clienteForm.reset()
                  }}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={clienteLoading}>
                  {clienteLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creando...
                    </>
                  ) : (
                    "Crear Cliente"
                  )}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  )
}
