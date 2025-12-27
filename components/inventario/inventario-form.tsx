"use client"

import { useState, useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { X } from "lucide-react"
import type { Inventario, TipoDispositivo } from "@/types"

const inventarioSchema = z.object({
  codigo: z.string().min(1, "El código es requerido"),
  nombre: z.string().min(1, "El nombre es requerido"),
  descripcion: z.string().optional(),
  categoria: z.string().min(1, "La categoría es requerida"),
  tipoDispositivo: z.enum(["CELULAR", "COMPUTADORA", "TABLET", "CONSOLA", "SMARTWATCH", "TODOS"]),
  stock: z.number().int().min(0),
  precioCompra: z.number().min(0),
  precioVenta: z.number().min(0),
  proveedor: z.string().optional(),
})

type InventarioFormData = z.infer<typeof inventarioSchema>

const categorias = [
  "Baterías",
  "Pantallas",
  "Carcasas",
  "Teclados",
  "Memoria",
  "Procesadores",
  "Otros",
]

interface InventarioFormProps {
  item?: Inventario | null
  onClose: () => void
  onSuccess: () => void
}

export function InventarioForm({
  item,
  onClose,
  onSuccess,
}: InventarioFormProps) {
  const [loading, setLoading] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
    setValue,
  } = useForm<InventarioFormData>({
    resolver: zodResolver(inventarioSchema),
    defaultValues: item
      ? {
          codigo: item.codigo,
          nombre: item.nombre,
          descripcion: item.descripcion || "",
          categoria: item.categoria,
          tipoDispositivo: item.tipoDispositivo as InventarioFormData["tipoDispositivo"],
          stock: item.stock,
          precioCompra: item.precioCompra,
          precioVenta: item.precioVenta,
          proveedor: item.proveedor || "",
        }
      : {
          codigo: "",
          nombre: "",
          descripcion: "",
          categoria: "",
          tipoDispositivo: "CELULAR",
          stock: 0,
          precioCompra: 0,
          precioVenta: 0,
          proveedor: "",
        },
  })

  useEffect(() => {
    if (item) {
      reset({
        codigo: item.codigo,
        nombre: item.nombre,
        descripcion: item.descripcion || "",
        categoria: item.categoria,
        tipoDispositivo: item.tipoDispositivo,
        stock: item.stock,
        precioCompra: item.precioCompra,
        precioVenta: item.precioVenta,
        proveedor: item.proveedor || "",
      })
    }
  }, [item, reset])

  const onSubmit = async (data: InventarioFormData) => {
    setLoading(true)
    try {
      const url = item ? `/api/inventario/${item.id}` : "/api/inventario"
      const method = item ? "PUT" : "POST"

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })

      if (!res.ok) {
        const error = await res.json()
        alert(error.error || "Error al guardar item")
        return
      }

      onSuccess()
    } catch (error) {
      console.error("Error saving item:", error)
      alert("Error al guardar item")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{item ? "Editar Item" : "Nuevo Item"}</CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="codigo">Código *</Label>
              <Input id="codigo" {...register("codigo")} placeholder="COD-001" />
              {errors.codigo && (
                <p className="text-sm text-destructive mt-1">
                  {errors.codigo.message}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="categoria">Categoría *</Label>
              <Select
                id="categoria"
                {...register("categoria")}
                onChange={(e) => setValue("categoria", e.target.value)}
              >
                <option value="">Seleccionar...</option>
                {categorias.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </Select>
              {errors.categoria && (
                <p className="text-sm text-destructive mt-1">
                  {errors.categoria.message}
                </p>
              )}
            </div>
          </div>

          <div>
            <Label htmlFor="nombre">Nombre *</Label>
            <Input id="nombre" {...register("nombre")} placeholder="Nombre del item" />
            {errors.nombre && (
              <p className="text-sm text-destructive mt-1">
                {errors.nombre.message}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="descripcion">Descripción</Label>
            <Textarea
              id="descripcion"
              {...register("descripcion")}
              placeholder="Descripción del item"
            />
          </div>

          <div>
            <Label htmlFor="tipoDispositivo">Tipo de Dispositivo *</Label>
            <Select
              id="tipoDispositivo"
              {...register("tipoDispositivo")}
              onChange={(e) =>
                setValue("tipoDispositivo", e.target.value as TipoDispositivo)
              }
            >
              <option value="CELULAR">Celular</option>
              <option value="COMPUTADORA">Computadora</option>
              <option value="TABLET">Tablet</option>
              <option value="CONSOLA">Consola</option>
              <option value="SMARTWATCH">Smartwatch</option>
              <option value="TODOS">Todos los dispositivos</option>
            </Select>
            {errors.tipoDispositivo && (
              <p className="text-sm text-destructive mt-1">
                {errors.tipoDispositivo.message}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="stock">Stock *</Label>
              <Input
                id="stock"
                type="number"
                {...register("stock", { valueAsNumber: true })}
                min={0}
              />
              {errors.stock && (
                <p className="text-sm text-destructive mt-1">
                  {errors.stock.message}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="precioCompra">Precio Compra *</Label>
              <Input
                id="precioCompra"
                type="number"
                step="0.01"
                {...register("precioCompra", { valueAsNumber: true })}
                min={0}
              />
              {errors.precioCompra && (
                <p className="text-sm text-destructive mt-1">
                  {errors.precioCompra.message}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="precioVenta">Precio Venta *</Label>
              <Input
                id="precioVenta"
                type="number"
                step="0.01"
                {...register("precioVenta", { valueAsNumber: true })}
                min={0}
              />
              {errors.precioVenta && (
                <p className="text-sm text-destructive mt-1">
                  {errors.precioVenta.message}
                </p>
              )}
            </div>
          </div>

          <div>
            <Label htmlFor="proveedor">Proveedor</Label>
            <Input
              id="proveedor"
              {...register("proveedor")}
              placeholder="Nombre del proveedor"
            />
          </div>

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Guardando..." : "Guardar"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

