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
import { X, ChevronDown, ChevronUp, Plus, Check, Loader2 } from "lucide-react"
import type { Inventario } from "@/types"
import { useTiposDispositivo } from "@/hooks/use-tipos-dispositivo"

const inventarioSchema = z.object({
  nombre: z.string().min(1, "El nombre es requerido"),
  categoria: z.string().min(1, "La categoría es requerida"),
  tipoDispositivo: z.string().min(1, "El tipo de dispositivo es requerido"),
  stock: z.number().int().min(0),
  precioCompra: z.number().min(0),
  precioVenta: z.number().min(0),
  stockMinimo: z.number().int().min(0).nullable().optional(),
  stockMaximo: z.number().int().min(0).nullable().optional(),
  puntoReorden: z.number().int().min(0).nullable().optional(),
})

type InventarioFormData = z.infer<typeof inventarioSchema>

// Categorías específicas por tipo de dispositivo
const categoriasPorTipo: Record<string, string[]> = {
  CELULAR: ["Pantallas", "Protectores", "Baterías", "Fundas", "Cargadores", "Flex", "Módulos", "Otros"],
  COMPUTADORA: ["Pantallas", "Teclados", "Baterías", "Memorias", "Discos", "Cargadores", "Otros"],
  TABLET: ["Pantallas", "Protectores", "Baterías", "Fundas", "Cargadores", "Flex", "Otros"],
  CONSOLA: ["Joysticks", "Fuentes", "Flex", "Lectoras", "Coolers", "Otros"],
  SMARTWATCH: ["Mallas", "Pantallas", "Baterías", "Cargadores", "Otros"],
  IMPRESORA: ["Cartuchos", "Tóners", "Cabezales", "Rodillos", "Fuentes", "Placas", "Otros"],
  NOTEBOOK: ["Pantallas", "Teclados", "Baterías", "Memorias", "Discos", "Cargadores", "Bisagras", "Otros"],
  LAPTOP: ["Pantallas", "Teclados", "Baterías", "Memorias", "Discos", "Cargadores", "Bisagras", "Otros"],
  TELEVISION: ["Pantallas", "Fuentes", "Placas", "LED", "Cables", "Controles", "Otros"],
  TV: ["Pantallas", "Fuentes", "Placas", "LED", "Cables", "Controles", "Otros"],
  HELADERA: ["Compresores", "Termostatos", "Motores", "Válvulas", "Resistencias", "Otros"],
  MICROONDAS: ["Magnetrones", "Fusibles", "Motores", "Placas", "Otros"],
  LAVARROPAS: ["Motores", "Bombas", "Correas", "Electrválvulas", "Placas", "Otros"],
  AIRE_ACONDICIONADO: ["Compresores", "Filtros", "Motores", "Placas", "Gas refrigerante", "Otros"],
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
  const [showStockConfig, setShowStockConfig] = useState(
    !!(item?.stockMinimo || item?.stockMaximo || item?.puntoReorden)
  )
  const [showNewCategoria, setShowNewCategoria] = useState(false)
  const [newCategoria, setNewCategoria] = useState("")
  const [savingCategoria, setSavingCategoria] = useState(false)

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
          stockMinimo: item.stockMinimo ?? null,
          stockMaximo: item.stockMaximo ?? null,
          puntoReorden: item.puntoReorden ?? null,
        }
      : {
          nombre: "",
          categoria: "",
          tipoDispositivo: "",
          stock: 0,
          precioCompra: 0,
          precioVenta: 0,
          stockMinimo: null,
          stockMaximo: null,
          puntoReorden: null,
        },
  })

  const categoria = watch("categoria")
  const tipoDispositivo = watch("tipoDispositivo")

  // Categorías disponibles según el tipo seleccionado
  // Prioritize dynamic categories from device type config, fallback to hardcoded map
  const categoriasDisponibles = (() => {
    if (!tipoDispositivo) return []
    const tipoConfig = tiposDispositivo.find(t => t.codigo === tipoDispositivo)
    const dynamicCats = tipoConfig?.config?.categoriasInventario
    if (dynamicCats && dynamicCats.length > 0) return dynamicCats
    return categoriasPorTipo[tipoDispositivo] || categoriasPorTipo.TODOS
  })()

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
        stockMinimo: item.stockMinimo ?? null,
        stockMaximo: item.stockMaximo ?? null,
        puntoReorden: item.puntoReorden ?? null,
      })
    }
  }, [item, reset])

  const handleAddCategoria = async () => {
    const nombre = newCategoria.trim()
    if (!nombre || !tipoDispositivo) return
    if (categoriasDisponibles.includes(nombre)) {
      setValue("categoria", nombre, { shouldValidate: true, shouldDirty: true })
      setShowNewCategoria(false)
      setNewCategoria("")
      return
    }

    setSavingCategoria(true)
    try {
      const tipo = tiposDispositivo.find(t => t.codigo === tipoDispositivo)
      if (!tipo) return

      const currentCats = tipo.config?.categoriasInventario || [...(categoriasPorTipo[tipoDispositivo] || categoriasPorTipo.TODOS)]
      const updatedConfig = {
        ...tipo.config,
        categoriasInventario: [...currentCats, nombre],
      }

      const res = await fetch(`/api/tipos-dispositivo/${tipo.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: updatedConfig }),
      })

      if (!res.ok) throw new Error("Error al guardar categoría")

      await refetchTipos()
      setValue("categoria", nombre, { shouldValidate: true, shouldDirty: true })
      setShowNewCategoria(false)
      setNewCategoria("")
    } catch (error) {
      console.error("Error adding category:", error)
      alert("Error al agregar categoría")
    } finally {
      setSavingCategoria(false)
    }
  }

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
              {showNewCategoria ? (
                <div className="flex gap-1.5">
                  <Input
                    value={newCategoria}
                    onChange={(e) => setNewCategoria(e.target.value)}
                    placeholder="Nueva categoría..."
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); handleAddCategoria() }
                      if (e.key === "Escape") { setShowNewCategoria(false); setNewCategoria("") }
                    }}
                    disabled={savingCategoria}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="shrink-0 h-9 w-9"
                    onClick={handleAddCategoria}
                    disabled={!newCategoria.trim() || savingCategoria}
                  >
                    {savingCategoria ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="shrink-0 h-9 w-9"
                    onClick={() => { setShowNewCategoria(false); setNewCategoria("") }}
                    disabled={savingCategoria}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex gap-1.5">
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
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="shrink-0 h-9 w-9"
                    onClick={() => setShowNewCategoria(true)}
                    disabled={!tipoDispositivo}
                    title="Agregar categoría"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              )}
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

          {/* Stock thresholds (collapsible) */}
          <div>
            <button
              type="button"
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setShowStockConfig(!showStockConfig)}
            >
              {showStockConfig ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              Configuración de stock
            </button>
            {showStockConfig && (
              <div className="grid grid-cols-3 gap-3 mt-2">
                <div>
                  <Label htmlFor="stockMinimo">Stock Mínimo</Label>
                  <Input
                    id="stockMinimo"
                    type="number"
                    {...register("stockMinimo", {
                      setValueAs: (v: string) => v === "" || v === null ? null : parseInt(v, 10),
                    })}
                    min={0}
                    placeholder="Auto"
                  />
                </div>
                <div>
                  <Label htmlFor="stockMaximo">Stock Máximo</Label>
                  <Input
                    id="stockMaximo"
                    type="number"
                    {...register("stockMaximo", {
                      setValueAs: (v: string) => v === "" || v === null ? null : parseInt(v, 10),
                    })}
                    min={0}
                    placeholder="Sin límite"
                  />
                </div>
                <div>
                  <Label htmlFor="puntoReorden">Punto Reorden</Label>
                  <Input
                    id="puntoReorden"
                    type="number"
                    {...register("puntoReorden", {
                      setValueAs: (v: string) => v === "" || v === null ? null : parseInt(v, 10),
                    })}
                    min={0}
                    placeholder="Auto"
                  />
                </div>
              </div>
            )}
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
