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
import { Textarea } from "@/components/ui/textarea"
import { useModal } from "@/contexts/modal-context"
import { Plus, Trash2, Search, Loader2, X } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import { useDebouncedValue } from "@/components/catalogo/use-debounced-value"
import {
  calcularTotalesVenta,
  type DescuentoConfig,
  type FiscalConfig,
  type IvaRegimen,
} from "@/lib/ventas/totales"

const itemSchema = z.object({
  id: z.string().optional(), // Para items existentes
  inventarioId: z.string().nullable().optional(),
  descripcion: z.string().trim().min(1, "Descripción requerida"),
  cantidad: z.number({ invalid_type_error: "Cantidad requerida" }).int("Sin decimales").min(1, "Mínimo 1"),
  precioUnitario: z.number({ invalid_type_error: "Precio requerido" }).positive("Precio inválido"),
  diasGarantia: z.number().int().min(0).default(0),
  // Descuento por línea: se conserva tal como se vendió
  descuento: z.number().min(0).default(0),
  tipoDescuento: z.enum(["MONTO", "PORCENTAJE"]).default("MONTO"),
  porcentajeDescuento: z.number().min(0).max(100).default(0),
})

const ventaEditSchema = z.object({
  clienteId: z.string().nullable().optional(),
  clienteNombre: z.string().trim().min(1, "Nombre del cliente requerido"),
  clienteTelefono: z.string().optional(),
  items: z.array(itemSchema).min(1, "Agrega al menos un producto"),
  tipoDescuentoGlobal: z.enum(["MONTO", "PORCENTAJE"]),
  descuentoGlobal: z.number({ invalid_type_error: "Descuento inválido" }).min(0),
  observaciones: z.string().optional(),
})

type VentaEditFormData = z.infer<typeof ventaEditSchema>

interface Cliente {
  id: string
  nombre: string
  telefono: string
}

interface ProductoEncontrado {
  id: string
  codigo: string
  nombre: string
  stock: number
  precioVenta: number
  trackeaSeries?: boolean
  diasGarantiaDefault?: number | null
}

interface VentaItem {
  id: string
  inventarioId: string | null
  descripcion: string
  cantidad: number
  precioUnitario: number
  diasGarantia: number
  descuento: number
  tipoDescuento: "MONTO" | "PORCENTAJE"
  porcentajeDescuento: number
}

interface VentaData {
  id: string
  numeroVenta: number
  clienteId: string | null
  clienteNombre: string
  clienteTelefono: string | null
  items: VentaItem[]
  /** Descuento global (sin los de línea): ver descuentoGlobalDeVenta. */
  descuentoGlobal: DescuentoConfig | null
  observaciones: string | null
  /** Lo ya cobrado: el total editado no puede quedar por debajo. */
  montoAbonado: number
  /** Si lo cobrado fue todo en efectivo (aplica el redondeo de efectivo). */
  cobroEnEfectivo: boolean
}

interface VentaEditFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  venta: VentaData
  onSuccess: () => void
}

function valoresIniciales(venta: VentaData): VentaEditFormData {
  return {
    clienteId: venta.clienteId,
    clienteNombre: venta.clienteNombre,
    clienteTelefono: venta.clienteTelefono || "",
    items: venta.items.map((item) => ({
      id: item.id,
      inventarioId: item.inventarioId,
      descripcion: item.descripcion,
      cantidad: item.cantidad,
      precioUnitario: item.precioUnitario,
      diasGarantia: item.diasGarantia,
      descuento: item.descuento,
      tipoDescuento: item.tipoDescuento,
      porcentajeDescuento: item.porcentajeDescuento,
    })),
    tipoDescuentoGlobal: venta.descuentoGlobal?.tipo ?? "MONTO",
    descuentoGlobal: venta.descuentoGlobal?.valor ?? 0,
    observaciones: venta.observaciones || "",
  }
}

export function VentaEditForm({ open, onOpenChange, venta, onSuccess }: VentaEditFormProps) {
  const { showError, showSuccess } = useModal()
  const { formatPrice } = useCurrency()
  const [loading, setLoading] = useState(false)
  const [fiscal, setFiscal] = useState<FiscalConfig | null>(null)

  const [searchCliente, setSearchCliente] = useState("")
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [showClienteSearch, setShowClienteSearch] = useState(false)
  const clienteQuery = useDebouncedValue(searchCliente, 300)

  const [searchProducto, setSearchProducto] = useState("")
  const [productos, setProductos] = useState<ProductoEncontrado[]>([])
  const productoQuery = useDebouncedValue(searchProducto, 300)

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
    defaultValues: valoresIniciales(venta),
  })

  const { fields, append, remove } = useFieldArray({ control, name: "items" })

  useEffect(() => {
    if (!open) return
    reset(valoresIniciales(venta))
    setSearchCliente("")
    setSearchProducto("")
    setShowClienteSearch(false)
  }, [open, venta, reset])

  // IVA y redondeo de la organización, para mostrar el mismo total que
  // calcula el servidor (lib/ventas/totales.ts).
  useEffect(() => {
    if (!open) return
    fetch("/api/configuracion/operativa")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return
        setFiscal({
          regimen: (data.ivaRegimen ?? "EXENTO") as IvaRegimen,
          tasa: Number(data.ivaTasa ?? 0),
          redondeoEfectivo: Number(data.redondeoEfectivo ?? 0),
        })
      })
      .catch(() => setFiscal(null))
  }, [open])

  useEffect(() => {
    if (!open || !showClienteSearch) return
    const params = new URLSearchParams({ limit: "10" })
    if (clienteQuery.trim()) params.set("search", clienteQuery.trim())
    let cancelado = false
    fetch(`/api/clientes?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelado) setClientes(Array.isArray(data?.data) ? data.data : [])
      })
      .catch(() => {
        if (!cancelado) setClientes([])
      })
    return () => {
      cancelado = true
    }
  }, [open, showClienteSearch, clienteQuery])

  useEffect(() => {
    const q = productoQuery.trim()
    if (!open || q.length < 2) {
      setProductos([])
      return
    }
    let cancelado = false
    fetch(`/api/inventario/search?${new URLSearchParams({ q, limit: "10" })}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (!cancelado) setProductos(Array.isArray(data) ? data : [])
      })
      .catch(() => {
        if (!cancelado) setProductos([])
      })
    return () => {
      cancelado = true
    }
  }, [open, productoQuery])

  const watchItems = watch("items")
  const watchClienteId = watch("clienteId")
  const tipoDescuentoGlobal = watch("tipoDescuentoGlobal")
  const valorDescuentoGlobal = watch("descuentoGlobal")

  const lineas = (watchItems || []).map((item) => ({
    cantidad: Number(item?.cantidad) || 0,
    precioUnitario: Number(item?.precioUnitario) || 0,
    tipoDescuento: item?.tipoDescuento,
    descuento: item?.descuento,
    porcentajeDescuento: item?.porcentajeDescuento,
  }))
  const totales = calcularTotalesVenta(
    lineas,
    { tipo: tipoDescuentoGlobal, valor: Number(valorDescuentoGlobal) || 0 },
    fiscal,
    venta.cobroEnEfectivo,
    1
  )
  const pendiente = Math.max(totales.total - venta.montoAbonado, 0)
  const totalPorDebajoDeLoCobrado = totales.total < venta.montoAbonado

  const selectCliente = (cliente: Cliente) => {
    setValue("clienteId", cliente.id)
    setValue("clienteNombre", cliente.nombre)
    setValue("clienteTelefono", cliente.telefono)
    setShowClienteSearch(false)
    setSearchCliente("")
  }

  const agregarProducto = (p: ProductoEncontrado) => {
    append({
      inventarioId: p.id,
      descripcion: p.nombre,
      cantidad: 1,
      precioUnitario: p.precioVenta,
      diasGarantia: p.diasGarantiaDefault ?? 0,
      descuento: 0,
      tipoDescuento: "MONTO",
      porcentajeDescuento: 0,
    })
    setSearchProducto("")
    setProductos([])
  }

  const onSubmit = async (data: VentaEditFormData) => {
    setLoading(true)
    try {
      const global = data.tipoDescuentoGlobal
      const res = await fetch(`/api/ventas/${venta.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "edit", // Para distinguir de anulación
          clienteId: data.clienteId || null,
          clienteNombre: data.clienteNombre,
          clienteTelefono: data.clienteTelefono || null,
          items: data.items.map((item) => ({
            inventarioId: item.inventarioId || null,
            descripcion: item.descripcion,
            cantidad: item.cantidad,
            precioUnitario: item.precioUnitario,
            diasGarantia: item.diasGarantia || 0,
            descuento: item.descuento || 0,
            tipoDescuento: item.tipoDescuento,
            porcentajeDescuento: item.porcentajeDescuento || 0,
          })),
          // El global va solo: los de línea viajan en cada item
          descuento: global === "MONTO" ? data.descuentoGlobal : 0,
          tipoDescuento: global,
          porcentajeDescuento: global === "PORCENTAJE" ? data.descuentoGlobal : 0,
          observaciones: data.observaciones || null,
        }),
      })

      const result = await res.json().catch(() => ({}))
      if (!res.ok) {
        await showError(result.error || "Error al actualizar la venta")
        return
      }

      if (result.advertencia) {
        await showError(result.advertencia)
      } else {
        await showSuccess("Venta actualizada correctamente")
      }
      onOpenChange(false)
      onSuccess()
    } catch (error) {
      console.error("Error updating venta:", error)
      await showError("Error al actualizar la venta")
    } finally {
      setLoading(false)
    }
  }

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
                <Label htmlFor="edit-cliente-nombre">Nombre del Cliente *</Label>
                <div className="relative">
                  <Input
                    id="edit-cliente-nombre"
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
                            placeholder="Buscar cliente registrado..."
                            className="pl-8"
                            value={searchCliente}
                            onChange={(e) => setSearchCliente(e.target.value)}
                            autoFocus
                          />
                        </div>
                        <div className="mt-2 max-h-40 overflow-y-auto">
                          {clientes.map((cliente) => (
                            <button
                              key={cliente.id}
                              type="button"
                              className="w-full rounded p-2 text-left text-sm hover:bg-muted"
                              onClick={() => selectCliente(cliente)}
                            >
                              <div className="font-medium">{cliente.nombre}</div>
                              <div className="text-xs text-muted-foreground">{cliente.telefono}</div>
                            </button>
                          ))}
                          {clientes.length === 0 && (
                            <p className="p-2 text-xs text-muted-foreground">Sin resultados</p>
                          )}
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
                {watchClienteId ? (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    Cliente registrado
                    <button
                      type="button"
                      className="inline-flex items-center gap-0.5 text-destructive hover:underline"
                      onClick={() => setValue("clienteId", null)}
                    >
                      <X className="h-3 w-3" /> quitar
                    </button>
                  </p>
                ) : null}
                {errors.clienteNombre && (
                  <p className="text-sm text-destructive">{errors.clienteNombre.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-cliente-telefono">Teléfono</Label>
                <Input id="edit-cliente-telefono" {...register("clienteTelefono")} placeholder="Teléfono" />
              </div>
            </div>
          </div>

          {/* Items */}
          <div className="space-y-4 rounded-lg border p-4">
            <div className="flex items-center justify-between gap-2">
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
                    descuento: 0,
                    tipoDescuento: "MONTO",
                    porcentajeDescuento: 0,
                  })
                }
              >
                <Plus className="mr-1 h-4 w-4" />
                Ítem libre
              </Button>
            </div>

            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar producto del inventario para agregar..."
                className="pl-8"
                value={searchProducto}
                onChange={(e) => setSearchProducto(e.target.value)}
              />
              {productos.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-md border bg-background shadow-lg">
                  <div className="max-h-48 overflow-y-auto p-2">
                    {productos.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        disabled={!!p.trackeaSeries}
                        className="w-full rounded p-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => agregarProducto(p)}
                      >
                        <div className="flex justify-between gap-2">
                          <span className="font-medium">{p.nombre}</span>
                          <span className="text-muted-foreground">Stock: {p.stock}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {p.trackeaSeries
                            ? "Tiene número de serie: se vende desde el POS"
                            : `${p.codigo} - ${formatPrice(p.precioVenta)}`}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {fields.map((field, index) => {
              const item = watchItems[index]
              const bruto = (Number(item?.cantidad) || 0) * (Number(item?.precioUnitario) || 0)
              const tieneDescuento =
                item?.tipoDescuento === "PORCENTAJE" ? (item?.porcentajeDescuento || 0) > 0 : (item?.descuento || 0) > 0
              return (
                <div key={field.id} className="space-y-3 rounded border bg-muted/30 p-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 space-y-2">
                      <Label>Producto *</Label>
                      <Input
                        {...register(`items.${index}.descripcion`)}
                        placeholder="Descripción del producto"
                      />
                      {!item?.inventarioId && (
                        <p className="text-xs text-muted-foreground">Ítem libre: no mueve stock</p>
                      )}
                      {errors.items?.[index]?.descripcion && (
                        <p className="text-sm text-destructive">{errors.items[index]?.descripcion?.message}</p>
                      )}
                    </div>
                    {fields.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="mt-8 text-destructive"
                        aria-label="Quitar producto"
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
                        step="1"
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
                        {formatPrice(bruto)}
                      </div>
                    </div>
                  </div>
                  {tieneDescuento && (
                    <p className="text-xs text-muted-foreground">
                      Descuento de la línea:{" "}
                      {item?.tipoDescuento === "PORCENTAJE"
                        ? `${item?.porcentajeDescuento}%`
                        : formatPrice(item?.descuento || 0)}
                    </p>
                  )}
                  {(errors.items?.[index]?.cantidad || errors.items?.[index]?.precioUnitario) && (
                    <p className="text-sm text-destructive">
                      {errors.items[index]?.cantidad?.message || errors.items[index]?.precioUnitario?.message}
                    </p>
                  )}
                </div>
              )
            })}

            {errors.items?.message && (
              <p className="text-sm text-destructive">{errors.items.message}</p>
            )}
          </div>

          {/* Totales */}
          <div className="space-y-4 rounded-lg border p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="edit-descuento">Descuento sobre el total</Label>
                <div className="flex gap-2">
                  <select
                    aria-label="Tipo de descuento"
                    className="h-10 rounded-md border border-input bg-background px-2 text-sm"
                    {...register("tipoDescuentoGlobal")}
                  >
                    <option value="MONTO">$</option>
                    <option value="PORCENTAJE">%</option>
                  </select>
                  <Input
                    id="edit-descuento"
                    type="number"
                    min="0"
                    step="0.01"
                    {...register("descuentoGlobal", { valueAsNumber: true })}
                  />
                </div>
                {errors.descuentoGlobal && (
                  <p className="text-sm text-destructive">{errors.descuentoGlobal.message}</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-observaciones">Observaciones</Label>
              <Textarea
                id="edit-observaciones"
                {...register("observaciones")}
                placeholder="Notas adicionales..."
                rows={2}
              />
            </div>

            {/* Resumen */}
            <div className="space-y-1 rounded-lg bg-muted p-4 text-sm">
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span>{formatPrice(totales.subtotal)}</span>
              </div>
              {totales.descuentoTotal > 0 && (
                <div className="flex justify-between text-destructive">
                  <span>Descuento:</span>
                  <span>-{formatPrice(totales.descuentoTotal)}</span>
                </div>
              )}
              {totales.iva > 0 && (
                <div className="flex justify-between">
                  <span>IVA ({fiscal?.tasa ?? 0}%):</span>
                  <span>{formatPrice(totales.iva)}</span>
                </div>
              )}
              {totales.redondeo !== 0 && (
                <div className="flex justify-between">
                  <span>Redondeo efectivo:</span>
                  <span>{(totales.redondeo > 0 ? "+" : "") + formatPrice(totales.redondeo)}</span>
                </div>
              )}
              <div className="mt-2 flex justify-between border-t pt-2 text-lg font-bold">
                <span>Total:</span>
                <span className="text-primary">{formatPrice(totales.total)}</span>
              </div>
              {venta.montoAbonado > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Ya cobrado:</span>
                  <span>{formatPrice(venta.montoAbonado)}</span>
                </div>
              )}
              {pendiente > 0 && (
                <div className="flex justify-between font-medium text-warning">
                  <span>Queda pendiente:</span>
                  <span>{formatPrice(pendiente)}</span>
                </div>
              )}
              {totalPorDebajoDeLoCobrado && (
                <p className="pt-1 text-xs text-destructive">
                  El total no puede quedar por debajo de lo ya cobrado. Para devolver dinero registrá una devolución.
                </p>
              )}
            </div>
          </div>

          {/* Botones */}
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading || totalPorDebajoDeLoCobrado}>
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
