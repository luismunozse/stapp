"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { X, ChevronDown, ChevronUp, Plus, Check, Loader2, ImagePlus, Trash2, Package } from "lucide-react"
import type { Inventario } from "@/types"
import { useTiposDispositivo } from "@/hooks/use-tipos-dispositivo"
import { compressImage } from "@/lib/image-compression"
import useSWR from "swr"

interface ProveedorLite {
  id: string
  nombre: string
  activo?: boolean
}

const proveedoresFetcher = (url: string): Promise<ProveedorLite[]> =>
  fetch(url).then((res) => res.json())

const inventarioSchema = z.object({
  nombre: z.string().min(1, "El nombre es requerido"),
  categoria: z.string().min(1, "La categoría es requerida"),
  tipoDispositivo: z.string().min(1, "El tipo de dispositivo es requerido"),
  stock: z.number().int().min(0),
  precioCompra: z.number().min(0),
  precioVenta: z.number().min(0),
  proveedorId: z.string().min(1).nullable().optional(),
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
  const [showNewTipo, setShowNewTipo] = useState(false)
  const [newTipo, setNewTipo] = useState("")
  const [savingTipo, setSavingTipo] = useState(false)

  // Imagen: el estado vive fuera de react-hook-form porque es multipart upload.
  // `imagenPreview` muestra preview inmediato; `pendingFile` es lo que se sube al submit.
  const [imagenPreview, setImagenPreview] = useState<string | null>(item?.imagenUrl || null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [removeExistingImage, setRemoveExistingImage] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Proveedores
  const { data: proveedores = [] } = useSWR<ProveedorLite[]>("/api/proveedores", proveedoresFetcher, {
    revalidateOnFocus: false,
  })

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
          proveedorId: item.proveedorId ?? null,
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
          proveedorId: null,
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
        proveedorId: item.proveedorId ?? null,
        stockMinimo: item.stockMinimo ?? null,
        stockMaximo: item.stockMaximo ?? null,
        puntoReorden: item.puntoReorden ?? null,
      })
      setImagenPreview(item.imagenUrl || null)
      setPendingFile(null)
      setRemoveExistingImage(false)
    }
  }, [item, reset])

  const handleAddTipo = async () => {
    const nombre = newTipo.trim()
    if (!nombre) return

    // Check if already exists
    const existing = tiposDispositivo.find(t => t.nombre.toLowerCase() === nombre.toLowerCase())
    if (existing) {
      setValue("tipoDispositivo", existing.codigo, { shouldValidate: true, shouldDirty: true })
      setShowNewTipo(false)
      setNewTipo("")
      return
    }

    setSavingTipo(true)
    try {
      // Generate codigo and prefijo from name
      const codigo = nombre
        .toUpperCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^A-Z0-9]/g, "_")
        .substring(0, 20)
      const prefijoOrden = nombre
        .toUpperCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^A-Z0-9]/g, "")
        .substring(0, 3)

      const res = await fetch("/api/tipos-dispositivo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo, nombre, prefijoOrden: prefijoOrden || "OTR" }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Error al crear tipo")
      }

      await refetchTipos()
      setValue("tipoDispositivo", codigo, { shouldValidate: true, shouldDirty: true })
      setShowNewTipo(false)
      setNewTipo("")
    } catch (error) {
      console.error("Error adding device type:", error)
      alert(error instanceof Error ? error.message : "Error al agregar tipo")
    } finally {
      setSavingTipo(false)
    }
  }

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

  const handleImagePick = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      alert("Seleccioná una imagen válida (JPG, PNG o WebP)")
      return
    }
    try {
      const compressed = await compressImage(file)
      setPendingFile(compressed)
      setRemoveExistingImage(false)
      const reader = new FileReader()
      reader.onloadend = () => setImagenPreview(reader.result as string)
      reader.readAsDataURL(compressed)
    } catch (err) {
      console.error("Error comprimiendo imagen:", err)
      alert("Error al procesar la imagen")
    }
  }

  const handleImageRemove = () => {
    setPendingFile(null)
    setImagenPreview(null)
    setRemoveExistingImage(!!item?.imagenUrl)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  // Sube la imagen pendiente (si hay) al endpoint dedicado. Requiere itemId.
  const uploadPendingImage = async (itemId: string) => {
    if (!pendingFile) return
    setUploadingImage(true)
    try {
      const formData = new FormData()
      formData.append("file", pendingFile)
      const res = await fetch(`/api/inventario/${itemId}/imagen`, {
        method: "POST",
        body: formData,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Error al subir imagen")
      }
    } finally {
      setUploadingImage(false)
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

      const savedItem = await res.json()
      const savedId = savedItem?.id || item?.id
      if (!savedId) {
        throw new Error("No se pudo obtener el id del item guardado")
      }

      // Manejo de imagen:
      //  - Si el usuario pidió quitar la existente, llamar DELETE
      //  - Si hay archivo pendiente, subirlo
      if (removeExistingImage && !pendingFile) {
        await fetch(`/api/inventario/${savedId}/imagen`, { method: "DELETE" }).catch(() => {})
      }
      if (pendingFile) {
        try {
          await uploadPendingImage(savedId)
        } catch (err) {
          console.error("Error subiendo imagen:", err)
          alert("El item se guardó pero hubo un error al subir la imagen")
        }
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
          {/* Fila con imagen + nombre */}
          <div className="flex gap-4 items-start">
            <div className="shrink-0">
              <Label className="mb-1 block">Imagen</Label>
              <div className="relative h-24 w-24 rounded-lg border-2 border-dashed border-border bg-muted/30 overflow-hidden flex items-center justify-center group">
                {imagenPreview ? (
                  <>
                    <img
                      src={imagenPreview}
                      alt="Preview"
                      className="h-full w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={handleImageRemove}
                      className="absolute top-1 right-1 h-5 w-5 rounded-full bg-destructive/90 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Quitar imagen"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </>
                ) : (
                  <Package className="h-8 w-8 text-muted-foreground/50" />
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleImagePick(file)
                  }}
                  title="Seleccionar imagen"
                />
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-1 text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                <ImagePlus className="h-3 w-3" />
                {imagenPreview ? "Cambiar" : "Subir foto"}
              </button>
            </div>
            <div className="flex-1">
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
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="tipoDispositivo">Tipo *</Label>
              {showNewTipo ? (
                <div className="flex gap-1.5">
                  <Input
                    value={newTipo}
                    onChange={(e) => setNewTipo(e.target.value)}
                    placeholder="Ej: Drone, Cafetera..."
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); handleAddTipo() }
                      if (e.key === "Escape") { setShowNewTipo(false); setNewTipo("") }
                    }}
                    disabled={savingTipo}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="shrink-0 h-9 w-9"
                    onClick={handleAddTipo}
                    disabled={!newTipo.trim() || savingTipo}
                  >
                    {savingTipo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="shrink-0 h-9 w-9"
                    onClick={() => { setShowNewTipo(false); setNewTipo("") }}
                    disabled={savingTipo}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex gap-1.5">
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
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="shrink-0 h-9 w-9"
                    onClick={() => setShowNewTipo(true)}
                    title="Agregar tipo"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              )}
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

          {/* Proveedor */}
          <div>
            <Label htmlFor="proveedor">Proveedor</Label>
            <Select
              value={watch("proveedorId") || "none"}
              onValueChange={(value) =>
                setValue("proveedorId", value === "none" ? null : value, {
                  shouldDirty: true,
                })
              }
            >
              <SelectTrigger id="proveedor">
                <SelectValue placeholder="Sin proveedor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin proveedor</SelectItem>
                {proveedores
                  .filter((p) => p.activo !== false)
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nombre}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
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
            <Button type="submit" disabled={loading || uploadingImage || (!item && !generatedCode)}>
              {uploadingImage ? "Subiendo imagen..." : loading ? "Guardando..." : "Guardar"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
