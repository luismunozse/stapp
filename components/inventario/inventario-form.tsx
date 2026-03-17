"use client"

import { useState, useEffect, useCallback } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { X } from "lucide-react"
import type { Inventario } from "@/types"
import { useTiposDispositivo } from "@/hooks/use-tipos-dispositivo"

const inventarioSchema = z.object({
  nombre: z.string().min(1, "El nombre es requerido"),
  categoria: z.string().min(1, "La categoría es requerida"),
  tipoDispositivo: z.string().min(1, "El tipo de dispositivo es requerido"),
  stock: z.number().int().min(0),
  precioCompra: z.number().min(0),
  precioVenta: z.number().min(0),
})

type InventarioFormData = z.infer<typeof inventarioSchema>

// Categorías específicas por tipo de dispositivo
const categoriasPorTipo: Record<string, string[]> = {
  CELULAR: ["Pantallas", "Protectores", "Baterías", "Fundas", "Cargadores", "Flex", "Módulos", "Otros"],
  COMPUTADORA: ["Pantallas", "Teclados", "Baterías", "Memorias", "Discos", "Cargadores", "Otros"],
  TABLET: ["Pantallas", "Protectores", "Baterías", "Fundas", "Cargadores", "Flex", "Otros"],
  CONSOLA: ["Joysticks", "Fuentes", "Flex", "Lectoras", "Coolers", "Otros"],
  SMARTWATCH: ["Mallas", "Pantallas", "Baterías", "Cargadores", "Otros"],
  ACCESORIOS: ["Auriculares", "Parlantes", "Cables", "Adaptadores", "Cargadores", "Soportes", "Otros"],
  TODOS: ["Pantallas", "Baterías", "Fundas", "Teclados", "Memorias", "Cargadores", "Otros"],
}

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
  const { tipos: tiposDispositivo, loading: tiposLoading, error: tiposError, refetch: refetchTipos } = useTiposDispositivo({ incluirTodos: true })
  const [loading, setLoading] = useState(false)
  const [generatedCode, setGeneratedCode] = useState<string>("")

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
          nombre: item.nombre,
          categoria: item.categoria,
          tipoDispositivo: item.tipoDispositivo,
          stock: item.stock,
          precioCompra: item.precioCompra,
          precioVenta: item.precioVenta,
        }
      : {
          nombre: "",
          categoria: "",
          tipoDispositivo: "",
          stock: 0,
          precioCompra: 0,
          precioVenta: 0,
        },
  })

  const categoria = watch("categoria")
  const tipoDispositivo = watch("tipoDispositivo")

  // Categorías disponibles según el tipo seleccionado
  const categoriasDisponibles = tipoDispositivo ? (categoriasPorTipo[tipoDispositivo] || categoriasPorTipo.TODOS) : []

  // Limpiar categoría cuando cambia el tipo
  useEffect(() => {
    if (tipoDispositivo && categoria && !categoriasDisponibles.includes(categoria)) {
      setValue("categoria", "")
    }
  }, [tipoDispositivo, categoria, categoriasDisponibles, setValue])

  // Generar código automáticamente para items nuevos
  const fetchCode = useCallback(async (cat: string, tipo: string) => {
    if (!cat || !tipo || item) return
    try {
      const params = new URLSearchParams({ categoria: cat, tipoDispositivo: tipo })
      const res = await fetch(`/api/inventario/next-code?${params}`)
      if (res.ok) {
        const data = await res.json()
        if (data.codigo) {
          setGeneratedCode(data.codigo)
        }
      }
    } catch (error) {
      console.error("Error fetching code:", error)
    }
  }, [item])

  useEffect(() => {
    if (!item && categoria && tipoDispositivo) {
      fetchCode(categoria, tipoDispositivo)
    }
  }, [categoria, tipoDispositivo, item, fetchCode])

  useEffect(() => {
    if (item) {
      reset({
        nombre: item.nombre,
        categoria: item.categoria,
        tipoDispositivo: item.tipoDispositivo,
        stock: item.stock,
        precioCompra: item.precioCompra,
        precioVenta: item.precioVenta,
      })
    }
  }, [item, reset])

  const onSubmit = async (data: InventarioFormData) => {
    setLoading(true)
    try {
      const url = item ? `/api/inventario/${item.id}` : "/api/inventario"
      const method = item ? "PUT" : "POST"

      const payload = item
        ? { ...data }
        : {
            ...data,
            codigo: generatedCode,
            descripcion: "",
            proveedor: "",
          }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const errorData = await res.json()
        // Si es error de código duplicado en item nuevo, regenerar código y reintentar
        if (!item && res.status === 400 && errorData.error?.includes("código")) {
          await fetchCode(data.categoria, data.tipoDispositivo)
          alert("El código generado ya existía. Se generó uno nuevo, intentá guardar de nuevo.")
          return
        }
        alert(errorData.error || "Error al guardar item")
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
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle>{item ? "Editar Item" : "Nuevo Item"}</CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <Label htmlFor="nombre">Nombre *</Label>
            <Input
              id="nombre"
              {...register("nombre")}
              placeholder="Ej: Batería iPhone 12"
              autoFocus
            />
            {errors.nombre && (
              <p className="text-sm text-destructive mt-1">
                {errors.nombre.message}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="tipoDispositivo">Tipo *</Label>
              <Select
                value={tipoDispositivo || ""}
                onValueChange={(value) => setValue("tipoDispositivo", value, { shouldValidate: true, shouldDirty: true })}
                disabled={tiposLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder={tiposLoading ? "Cargando tipos..." : "Seleccionar..."} />
                </SelectTrigger>
                <SelectContent>
                  {tiposDispositivo.map((tipo) => (
                    <SelectItem key={tipo.id} value={tipo.codigo}>
                      {tipo.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.tipoDispositivo && (
                <p className="text-sm text-destructive mt-1">
                  {errors.tipoDispositivo.message}
                </p>
              )}
              {tiposError && (
                <p className="text-sm text-destructive mt-1 cursor-pointer" onClick={refetchTipos}>
                  Error al cargar tipos. Toca para reintentar.
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="categoria">Categoría *</Label>
              <Select
                value={watch("categoria") || ""}
                onValueChange={(value) => setValue("categoria", value, { shouldValidate: true, shouldDirty: true })}
                disabled={!tipoDispositivo}
              >
                <SelectTrigger>
                  <SelectValue placeholder={tipoDispositivo ? "Seleccionar..." : "Elegí tipo primero"} />
                </SelectTrigger>
                <SelectContent>
                  {categoriasDisponibles.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.categoria && (
                <p className="text-sm text-destructive mt-1">
                  {errors.categoria.message}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
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
              <Label htmlFor="precioCompra">Costo *</Label>
              <Input
                id="precioCompra"
                type="number"
                step="0.01"
                {...register("precioCompra", { valueAsNumber: true })}
                min={0}
                placeholder="0.00"
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
                placeholder="0.00"
              />
              {errors.precioVenta && (
                <p className="text-sm text-destructive mt-1">
                  {errors.precioVenta.message}
                </p>
              )}
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading || (!item && !generatedCode)}>
              {loading ? "Guardando..." : "Guardar"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
