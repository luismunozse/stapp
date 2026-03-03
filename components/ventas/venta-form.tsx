"use client"

import { useState, useEffect, useRef } from "react"
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
import { Textarea } from "@/components/ui/textarea"
import { useModal } from "@/contexts/modal-context"
import { Plus, Trash2, Package, Search, Loader2, Banknote, ArrowRightLeft, CreditCard, Wallet, MoreHorizontal } from "lucide-react"
import { cn } from "@/lib/utils"
import { useCurrency } from "@/contexts/currency-context"

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
  descuento: z.number().min(0).default(0),
  tipoDescuento: z.enum(["MONTO", "PORCENTAJE"]).default("MONTO"),
  porcentajeDescuento: z.number().min(0).max(100).default(0),
})

const METODOS_PAGO = [
  { value: "EFECTIVO", label: "Efectivo", icon: Banknote },
  { value: "TRANSFERENCIA", label: "Transferencia", icon: ArrowRightLeft },
  { value: "TARJETA_DEBITO", label: "Tarjeta Débito", icon: CreditCard },
  { value: "TARJETA_CREDITO", label: "Tarjeta Crédito", icon: CreditCard },
  { value: "MERCADOPAGO", label: "MercadoPago", icon: Wallet },
  { value: "OTRO", label: "Otro", icon: MoreHorizontal },
] as const

type MetodoPago = typeof METODOS_PAGO[number]["value"]

const ventaSchema = z.object({
  clienteId: z.string().nullable().optional(),
  clienteNombre: z.string().min(1, "Nombre del cliente requerido"),
  clienteTelefono: z.string().optional(),
  items: z.array(itemSchema).min(1, "Agrega al menos un producto"),
  descuento: z.number().min(0).default(0),
  tipoDescuento: z.enum(["MONTO", "PORCENTAJE"]).default("MONTO"),
  porcentajeDescuento: z.number().min(0).max(100).default(0),
  metodoPago: z.enum(["EFECTIVO", "TRANSFERENCIA", "TARJETA", "TARJETA_DEBITO", "TARJETA_CREDITO", "MERCADOPAGO", "OTRO"]),
  observaciones: z.string().optional(),
  cuotas: z.number().int().min(1).nullable().optional(),
  recargoPorcentaje: z.number().min(0).max(100).nullable().optional(),
  numeroReferencia: z.string().optional(),
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
  const { formatPrice } = useCurrency()
  const [loading, setLoading] = useState(false)
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [invResults, setInvResults] = useState<Record<number, Inventario[]>>({})
  const [invLoading, setInvLoading] = useState<Record<number, boolean>>({})
  const [searchCliente, setSearchCliente] = useState("")
  const [searchInventario, setSearchInventario] = useState<Record<number, string>>({})
  const [activeInvDropdown, setActiveInvDropdown] = useState<number | null>(null)
  const invDropdownRef = useRef<HTMLDivElement>(null)
  const [showClienteSearch, setShowClienteSearch] = useState(false)
  const [showClienteModal, setShowClienteModal] = useState(false)
  const [clienteLoading, setClienteLoading] = useState(false)
  const clienteDropdownRef = useRef<HTMLDivElement>(null)

  // Cerrar dropdowns al hacer click afuera
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (showClienteSearch && clienteDropdownRef.current && !clienteDropdownRef.current.contains(e.target as Node)) {
        setShowClienteSearch(false)
      }
      if (activeInvDropdown !== null && invDropdownRef.current && !invDropdownRef.current.contains(e.target as Node)) {
        setActiveInvDropdown(null)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [showClienteSearch, activeInvDropdown])

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
      items: [{ inventarioId: null, descripcion: "", cantidad: 1, precioUnitario: 0, diasGarantia: 0, descuento: 0, tipoDescuento: "MONTO" as const, porcentajeDescuento: 0 }],
      descuento: 0,
      tipoDescuento: "MONTO" as const,
      porcentajeDescuento: 0,
      metodoPago: "EFECTIVO",
      observaciones: "",
      cuotas: null,
      recargoPorcentaje: null,
      numeroReferencia: "",
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
  const watchTipoDescuento = watch("tipoDescuento")
  const watchPorcentajeDescuento = watch("porcentajeDescuento") || 0
  const watchMetodoPago = watch("metodoPago")
  const watchCuotas = watch("cuotas")
  const watchRecargo = watch("recargoPorcentaje")

  const showReferencia = watchMetodoPago === "TRANSFERENCIA" || watchMetodoPago === "MERCADOPAGO"
  const showCuotas = watchMetodoPago === "TARJETA_CREDITO"
  const showRecargo = watchMetodoPago === "TARJETA_CREDITO" || watchMetodoPago === "TARJETA_DEBITO"

  const subtotal = watchItems.reduce(
    (sum, item) => sum + (item.cantidad || 0) * (item.precioUnitario || 0),
    0
  )
  const descuentoMonto = watchTipoDescuento === "PORCENTAJE"
    ? subtotal * (watchPorcentajeDescuento / 100)
    : watchDescuento
  const total = subtotal - descuentoMonto

  // Cargar clientes
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()

    const fetchClientes = async () => {
      try {
        const res = await fetch("/api/clientes?limit=100", { signal: controller.signal, cache: "no-store" })
        const data = await res.json()
        const items = data.data ?? (Array.isArray(data) ? data : [])
        setClientes(items)
      } catch (error) {
        if (!controller.signal.aborted) console.error("Error fetching clientes:", error)
      }
    }

    fetchClientes()
    return () => controller.abort()
  }, [open])

  // Debounced server-side inventory search per item row
  useEffect(() => {
    if (activeInvDropdown === null) return
    const index = activeInvDropdown
    const query = searchInventario[index] || ""

    const timer = setTimeout(async () => {
      if (!query.trim() && !open) return
      setInvLoading((prev) => ({ ...prev, [index]: true }))
      try {
        const params = new URLSearchParams({ q: query, limit: "10" })
        const res = await fetch(`/api/inventario/search?${params}`, { cache: "no-store" })
        const data = await res.json()
        setInvResults((prev) => ({ ...prev, [index]: Array.isArray(data) ? data : [] }))
      } catch {
        setInvResults((prev) => ({ ...prev, [index]: [] }))
      } finally {
        setInvLoading((prev) => ({ ...prev, [index]: false }))
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [searchInventario, activeInvDropdown, open])

  const searchClienteQuery = searchCliente.toLowerCase().trim()
  const filteredClientes = searchClienteQuery
    ? clientes.filter(
        (c) =>
          c.nombre.toLowerCase().includes(searchClienteQuery) ||
          c.telefono.includes(searchClienteQuery)
      )
    : clientes

  const getFilteredInventario = (index: number): Inventario[] => {
    return invResults[index] || []
  }

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
    setSearchInventario((prev) => {
      const next = { ...prev }
      delete next[index]
      return next
    })
    setActiveInvDropdown(null)
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

  const handleMetodoChange = (value: MetodoPago) => {
    setValue("metodoPago", value)
    if (value !== "TARJETA_CREDITO" && value !== "TARJETA_DEBITO") {
      setValue("cuotas", null)
      setValue("recargoPorcentaje", null)
    }
    if (value !== "TRANSFERENCIA" && value !== "MERCADOPAGO") {
      setValue("numeroReferencia", "")
    }
    if (value === "TARJETA_CREDITO") {
      setValue("cuotas", 1)
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
        organizationName: ventaData.organizationName || undefined,
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
                  <div className="relative flex-1" ref={clienteDropdownRef}>
                    <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <Input
                      placeholder="Buscar cliente por nombre o teléfono..."
                      className="pl-8"
                      value={searchCliente || watch("clienteNombre")}
                      onChange={(e) => {
                        setSearchCliente(e.target.value)
                        setValue("clienteNombre", e.target.value)
                        setValue("clienteId", null)
                        setShowClienteSearch(true)
                      }}
                      onFocus={() => setShowClienteSearch(true)}
                    />
                    {showClienteSearch && filteredClientes.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full rounded-md border bg-background shadow-lg">
                        <div className="max-h-48 overflow-y-auto">
                          {filteredClientes.slice(0, 8).map((cliente) => (
                            <button
                              key={cliente.id}
                              type="button"
                              className="w-full px-4 py-2 text-left hover:bg-muted"
                              onClick={() => {
                                selectCliente(cliente)
                                setSearchCliente("")
                              }}
                            >
                              <div className="font-medium">{cliente.nombre}</div>
                              <div className="text-xs text-muted-foreground">{cliente.telefono}</div>
                            </button>
                          ))}
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
                onClick={() => append({ inventarioId: null, descripcion: "", cantidad: 1, precioUnitario: 0, diasGarantia: 0, descuento: 0, tipoDescuento: "MONTO", porcentajeDescuento: 0 })}
              >
                <Plus className="mr-1 h-4 w-4" />
                Agregar
              </Button>
            </div>

            <div className="space-y-3">
              {fields.map((field, index) => (
                <div key={field.id} className="grid gap-3 rounded-lg bg-muted/50 p-3 sm:grid-cols-12">
                  {/* Producto (búsqueda unificada) */}
                  <div className="sm:col-span-5" ref={activeInvDropdown === index ? invDropdownRef : undefined}>
                    <Label className="text-xs">Producto</Label>
                    <div className="relative">
                      <Package className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                      <Input
                        className="pl-7"
                        placeholder="Buscar en stock o escribir..."
                        value={searchInventario[index] ?? watchItems[index]?.descripcion ?? ""}
                        onChange={(e) => {
                          const val = e.target.value
                          setSearchInventario((prev) => ({ ...prev, [index]: val }))
                          setValue(`items.${index}.descripcion`, val)
                          setValue(`items.${index}.inventarioId`, null)
                          setActiveInvDropdown(index)
                        }}
                        onFocus={() => setActiveInvDropdown(index)}
                      />
                      {watchItems[index]?.inventarioId && (
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                          Stock
                        </span>
                      )}
                      {activeInvDropdown === index && (
                        <div className="absolute z-10 mt-1 w-full rounded-md border bg-background shadow-lg">
                          <div className="max-h-40 overflow-y-auto">
                            {invLoading[index] ? (
                              <div className="px-3 py-2 text-sm text-muted-foreground flex items-center gap-2">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Buscando...
                              </div>
                            ) : getFilteredInventario(index).length > 0 ? (
                              getFilteredInventario(index).map((inv) => (
                                <button
                                  key={inv.id}
                                  type="button"
                                  className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                                  onClick={() => selectInventarioItem(index, inv)}
                                >
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <span className="font-medium">{inv.nombre}</span>
                                      <span className="ml-2 text-xs text-muted-foreground">{inv.codigo}</span>
                                    </div>
                                    <div className="flex items-center gap-3 text-xs">
                                      <span className="text-muted-foreground">Stock: {inv.stock}</span>
                                      <span className="font-medium">{formatPrice(inv.precioVenta)}</span>
                                    </div>
                                  </div>
                                </button>
                              ))
                            ) : searchInventario[index] ? (
                              <div className="px-3 py-2 text-sm text-muted-foreground">
                                Sin resultados — se agregará como producto manual
                              </div>
                            ) : null}
                          </div>
                        </div>
                      )}
                    </div>
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
              <div className="grid grid-cols-3 sm:grid-cols-3 gap-2">
                {METODOS_PAGO.map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => handleMetodoChange(value)}
                    className={cn(
                      "flex flex-col items-center gap-1 p-2.5 rounded-lg border-2 text-center transition-all text-xs",
                      watchMetodoPago === value
                        ? "border-primary bg-primary/5 text-primary font-medium"
                        : "border-border hover:border-muted-foreground/30 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="leading-tight">{label}</span>
                  </button>
                ))}
              </div>

              {/* Cuotas y recargo para tarjeta crédito */}
              {showCuotas && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Cuotas</Label>
                    <Input
                      type="number"
                      min={1}
                      max={48}
                      placeholder="1"
                      {...register("cuotas", { valueAsNumber: true })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Recargo %</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      max={100}
                      placeholder="0"
                      {...register("recargoPorcentaje", { valueAsNumber: true })}
                    />
                  </div>
                </div>
              )}

              {/* Recargo solo débito */}
              {watchMetodoPago === "TARJETA_DEBITO" && (
                <div className="space-y-1">
                  <Label className="text-xs">Recargo % (si aplica)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    max={100}
                    placeholder="0"
                    {...register("recargoPorcentaje", { valueAsNumber: true })}
                  />
                </div>
              )}

              {/* Referencia para transferencia/mercadopago */}
              {showReferencia && (
                <div className="space-y-1">
                  <Label className="text-xs">Nro. de referencia</Label>
                  <Input
                    {...register("numeroReferencia")}
                    placeholder={
                      watchMetodoPago === "TRANSFERENCIA"
                        ? "CBU, alias o nro. de operación"
                        : "Nro. de operación MercadoPago"
                    }
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label>Descuento</Label>
                <div className="flex gap-2">
                  <div className="flex rounded-md border overflow-hidden">
                    <button
                      type="button"
                      className={cn(
                        "px-2.5 py-1.5 text-xs font-medium transition-colors",
                        watchTipoDescuento === "MONTO"
                          ? "bg-primary text-primary-foreground"
                          : "bg-background text-muted-foreground hover:bg-muted"
                      )}
                      onClick={() => {
                        setValue("tipoDescuento", "MONTO")
                        setValue("porcentajeDescuento", 0)
                      }}
                    >
                      $
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "px-2.5 py-1.5 text-xs font-medium transition-colors",
                        watchTipoDescuento === "PORCENTAJE"
                          ? "bg-primary text-primary-foreground"
                          : "bg-background text-muted-foreground hover:bg-muted"
                      )}
                      onClick={() => {
                        setValue("tipoDescuento", "PORCENTAJE")
                        setValue("descuento", 0)
                      }}
                    >
                      %
                    </button>
                  </div>
                  {watchTipoDescuento === "PORCENTAJE" ? (
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      placeholder="0%"
                      {...register("porcentajeDescuento", { valueAsNumber: true })}
                    />
                  ) : (
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      {...register("descuento", { valueAsNumber: true })}
                    />
                  )}
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
            </div>

            <div className="space-y-4 rounded-lg border bg-muted/50 p-4">
              <h3 className="font-medium">Resumen</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Subtotal:</span>
                  <span>{formatPrice(subtotal)}</span>
                </div>
                {descuentoMonto > 0 && (
                  <div className="flex justify-between text-sm text-destructive">
                    <span>
                      Descuento{watchTipoDescuento === "PORCENTAJE" ? ` (${watchPorcentajeDescuento}%)` : ""}:
                    </span>
                    <span>-{formatPrice(descuentoMonto)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t pt-2 text-lg font-bold">
                  <span>Total:</span>
                  <span className="text-primary">{formatPrice(total)}</span>
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
