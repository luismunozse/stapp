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
import { FormActionBar } from "@/components/ui/form-action-bar"
import { X, ChevronDown, ChevronUp, Plus, Check, Loader2, ImagePlus, Trash2, Package, AlertTriangle, PlusCircle, Pencil, MapPin } from "lucide-react"
import type { Inventario } from "@/types"
import { useTiposDispositivo } from "@/hooks/use-tipos-dispositivo"
import { compressImage } from "@/lib/image-compression"
import { validateBarcode, computeEAN13CheckDigit } from "@/lib/barcode-validation"
import useSWR from "swr"
import { useModal } from "@/contexts/modal-context"

interface ProveedorLite {
  id: string
  nombre: string
  activo?: boolean
}

interface DuplicateMatch {
  id: string
  codigo: string
  nombre: string
  categoria: string
  tipoDispositivo: string
  stock: number
  precioCompra: number
  precioVenta: number
  proveedor: string | null
  score: number
}

const proveedoresFetcher = async (url: string): Promise<ProveedorLite[]> => {
  // El endpoint puede devolver `{error: ...}` (401, 500, etc). Sin guard,
  // SWR setea data = objeto y .filter()/.map() rompen en runtime.
  const res = await fetch(url)
  const data = await res.json().catch(() => null)
  return Array.isArray(data) ? data : []
}

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
  ubicacion: z.string().max(200, "Máximo 200 caracteres").nullable().optional(),
  // Validación de checksum NO bloquea: el form muestra sugerencia inline
  // (ver bloque debajo del input). Códigos internos / impresos sin checksum
  // estricto deben poder guardarse igual; bloquearlos fue causa de "no se
  // registran EAN-13" en codes genéricos no-GS1.
  barcode: z.string().nullable().optional(),
  diasGarantiaDefault: z.number().int().min(0).nullable().optional(),
  trackeaLotes: z.boolean().optional(),
  trackeaSeries: z.boolean().optional(),
  tieneVariantes: z.boolean().optional(),
  esKit: z.boolean().optional(),
  tipoKit: z.enum(["ENSAMBLADO", "VIRTUAL"]).nullable().optional(),
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
  // Barcode pre-cargado (p.ej. desde scanner cuando se crea un item nuevo)
  initialBarcode?: string | null
  onClose: () => void
  onSuccess: () => void
  // Disparado al pedir editar un duplicado detectado. El padre debe cargar
  // ese item y reabrir el form en modo edición.
  onEditExisting?: (id: string) => void
}

export function InventarioForm({
  item,
  initialBarcode,
  onClose,
  onSuccess,
  onEditExisting,
}: InventarioFormProps) {
  const { showError, showWarning } = useModal()
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

  // Detección de duplicados (solo alta nueva): nombre normalizado + mismo tipo + misma categoría.
  // Señal suave; el usuario decide si consolidar, editar el existente o crear igual.
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([])
  const [consolidating, setConsolidating] = useState<string | null>(null)

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
          barcode: item.barcode ?? null,
          diasGarantiaDefault: (item as any).diasGarantiaDefault ?? null,
          ubicacion: item.ubicacion ?? null,
          trackeaLotes: item.trackeaLotes ?? false,
          trackeaSeries: item.trackeaSeries ?? false,
          tieneVariantes: item.tieneVariantes ?? false,
          esKit: item.esKit ?? false,
          tipoKit: item.tipoKit ?? null,
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
          barcode: initialBarcode ?? null,
          diasGarantiaDefault: null,
          ubicacion: null,
          trackeaLotes: false,
          trackeaSeries: false,
          tieneVariantes: false,
          esKit: false,
          tipoKit: null,
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

  // Generar código automáticamente para items nuevos.
  // Usado también en el reintento de submit cuando hay colisión de código.
  const fetchCode = useCallback(async (cat: string, tipo: string, signal?: AbortSignal) => {
    if (!cat || !tipo || item) return
    try {
      const params = new URLSearchParams({ categoria: cat, tipoDispositivo: tipo })
      const res = await fetch(`/api/inventario/next-code?${params}`, { signal })
      if (res.ok) {
        const data = await res.json()
        if (data.codigo) {
          setGeneratedCode(data.codigo)
        }
      }
    } catch (error) {
      if ((error as Error)?.name === "AbortError") return
      console.error("Error fetching code:", error)
    }
  }, [item])

  // Debounce + abort: cambios rápidos de tipo/categoría no disparan N requests.
  useEffect(() => {
    if (item || !categoria || !tipoDispositivo) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      fetchCode(categoria, tipoDispositivo, controller.signal)
    }, 200)
    return () => {
      clearTimeout(timer)
      controller.abort()
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
        barcode: item.barcode ?? null,
        diasGarantiaDefault: (item as any).diasGarantiaDefault ?? null,
        ubicacion: item.ubicacion ?? null,
        trackeaLotes: item.trackeaLotes ?? false,
        trackeaSeries: item.trackeaSeries ?? false,
        tieneVariantes: item.tieneVariantes ?? false,
        esKit: item.esKit ?? false,
        tipoKit: item.tipoKit ?? null,
      })
      setImagenPreview(item.imagenUrl || null)
      setPendingFile(null)
      setRemoveExistingImage(false)
    }
  }, [item, reset])

  // Pre-fill barcode from scanner.
  // - Item nuevo: setea siempre.
  // - Item existente: setea solo si barcode está vacío (caso scanner matcheó
  //   por codigo y queremos persistir el EAN para próximos escaneos).
  useEffect(() => {
    if (!initialBarcode) return
    if (!item) {
      setValue("barcode", initialBarcode, { shouldDirty: true, shouldTouch: true })
    } else if (!item.barcode) {
      setValue("barcode", initialBarcode, { shouldDirty: true, shouldTouch: true })
    }
  }, [item, initialBarcode, setValue])

  // Duplicate detection — dispara on blur del nombre (cuando el usuario pasa
  // al siguiente input). Fuzzy match por tokens en el backend; tipo/categoría
  // son filtros opcionales que acotan si están presentes.
  const nombre = watch("nombre")
  const checkDuplicates = useCallback(async () => {
    if (item) return
    const trimmed = (nombre || "").trim()
    if (trimmed.length < 2) {
      setDuplicates([])
      return
    }
    try {
      const params = new URLSearchParams({ nombre: trimmed })
      if (tipoDispositivo) params.set("tipo", tipoDispositivo)
      if (categoria) params.set("categoria", categoria)
      const res = await fetch(`/api/inventario/check-duplicate?${params}`)
      if (!res.ok) return
      const data = await res.json()
      setDuplicates(data.matches || [])
    } catch { /* network error */ }
  }, [nombre, tipoDispositivo, categoria, item])

  // Si el usuario sigue escribiendo tras ver el aviso, limpiamos el warning
  // para evitar mostrar matches desactualizados.
  useEffect(() => {
    setDuplicates([])
  }, [nombre])

  // Sumar stock del item nuevo al existente y cerrar el formulario.
  // Genera un movimiento ENTRADA con referenciaTipo=CONSOLIDACION para trazabilidad.
  const handleConsolidate = async (match: DuplicateMatch) => {
    const values = watch()
    const stockToAdd = Number(values.stock) || 0
    if (stockToAdd <= 0) {
      await showError("Ingresá una cantidad de stock mayor a 0 para sumar al existente.")
      return
    }
    setConsolidating(match.id)
    try {
      const res = await fetch(`/api/inventario/${match.id}/stock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "delta",
          value: stockToAdd,
          tipo: "ENTRADA",
          referenciaTipo: "CONSOLIDACION",
          motivo: `Consolidación desde alta duplicada (${values.nombre})`,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Error al sumar stock")
      }
      onSuccess()
    } catch (err) {
      console.error("Error consolidando stock:", err)
      await showError(err instanceof Error ? err.message : "Error al sumar stock")
    } finally {
      setConsolidating(null)
    }
  }

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
      await showError(error instanceof Error ? error.message : "Error al agregar tipo")
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
      await showError("Error al agregar categoría")
    } finally {
      setSavingCategoria(false)
    }
  }

  const handleImagePick = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      await showError("Seleccioná una imagen válida (JPG, PNG o WebP)")
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
      await showError("Error al procesar la imagen")
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

      // Fallback explícito de barcode: si RHF entregó null/undefined pero el
      // input visual tiene contenido (por setValue() programático del scanner
      // u otra interacción que no dispara setValueAs), leemos via watch() y
      // normalizamos antes de enviar.
      const barcodeFromWatch = (watch("barcode") || "").toString().trim()
      const normalizedBarcode = barcodeFromWatch.length > 0 ? barcodeFromWatch : null

      const payload = item
        ? { ...data, barcode: normalizedBarcode }
        : {
            ...data,
            barcode: normalizedBarcode,
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
          await showWarning("El código generado ya existía. Se generó uno nuevo, intentá guardar de nuevo.")
          return
        }
        await showError(errorData.error || "Error al guardar item")
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
          await showWarning("El item se guardó pero hubo un error al subir la imagen")
        }
      }

      onSuccess()
    } catch (error) {
      console.error("Error saving item:", error)
      await showError("Error al guardar item")
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
        <form
          onSubmit={handleSubmit(onSubmit)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return
            const t = e.target as HTMLElement
            const tag = t.tagName
            if (tag === "TEXTAREA") return
            if (tag === "BUTTON" && (t as HTMLButtonElement).type === "submit") return
            e.preventDefault()
          }}
          className="space-y-4"
        >
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
                {...register("nombre", { onBlur: () => checkDuplicates() })}
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

          {!item && duplicates.length > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
              <div className="flex items-start gap-2 text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
                <div className="flex-1">
                  <p className="font-medium">
                    {duplicates.length === 1
                      ? "Posible duplicado: hay un producto con nombre similar."
                      : `Posibles duplicados: ${duplicates.length} productos con nombre similar.`}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Revisá si es el mismo. Podés sumar stock al existente, editarlo, o crear uno nuevo igualmente.
                  </p>
                </div>
              </div>
              <ul className="space-y-1.5">
                {duplicates.map((match) => (
                  <li
                    key={match.id}
                    className="flex flex-col sm:flex-row sm:items-center gap-2 rounded border bg-background p-2 text-sm"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{match.nombre}</div>
                      <div className="text-xs text-muted-foreground">
                        {match.codigo} · {match.tipoDispositivo} / {match.categoria} · Stock: {match.stock}
                        {match.proveedor ? ` · ${match.proveedor}` : ""}
                      </div>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <Button
                        type="button"
                        size="sm"
                        variant="default"
                        className="h-8 gap-1"
                        onClick={() => handleConsolidate(match)}
                        disabled={consolidating !== null}
                      >
                        {consolidating === match.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <PlusCircle className="h-3.5 w-3.5" />
                        )}
                        Sumar stock
                      </Button>
                      {onEditExisting && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1"
                          onClick={() => onEditExisting(match.id)}
                          disabled={consolidating !== null}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Editar este
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label htmlFor="stock">Stock *</Label>
              <Input
                id="stock"
                type="text"
                inputMode="numeric"
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
                type="text"
                inputMode="decimal"
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
                type="text"
                inputMode="decimal"
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
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
                <div>
                  <Label htmlFor="stockMinimo">Stock Mínimo</Label>
                  <Input
                    id="stockMinimo"
                    type="text"
                    inputMode="numeric"
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
                    type="text"
                    inputMode="numeric"
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
                    type="text"
                    inputMode="numeric"
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

          <div className="space-y-1.5">
            <Label htmlFor="ubicacion" className="flex items-center gap-1.5 text-sm font-medium">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
              Ubicación en depósito
            </Label>
            <Input
              id="ubicacion"
              {...register("ubicacion", {
                setValueAs: (v: string) => v === "" || v === null ? null : v,
              })}
              placeholder="Ej: Rack 1 / Fila 2 / Columna 3"
              maxLength={200}
            />
            <p className="text-xs text-muted-foreground">
              Dónde está físicamente el repuesto en tu depósito.
            </p>
            {errors.ubicacion && (
              <p className="text-sm text-destructive">{errors.ubicacion.message}</p>
            )}
          </div>

          <div>
            <Label htmlFor="barcode">Código de Barras</Label>
            <Input
              id="barcode"
              {...register("barcode", {
                setValueAs: (v: string) => {
                  if (v === null || v === undefined) return null
                  const t = String(v).trim()
                  return t === "" ? null : t
                },
              })}
              placeholder="Escanear o ingresar código de barras"
              inputMode="text"
              autoComplete="off"
            />
            {(() => {
              const v = (watch("barcode") || "").trim()
              if (!v) return null
              const err = validateBarcode(v)
              if (err) {
                const label = err.kind === "invalid_ean13" ? "EAN-13" : err.kind === "invalid_ean8" ? "EAN-8" : "UPC-A"
                return (
                  <div className="mt-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-800">
                    Dígito verificador {label} no cierra. Sugerido:{" "}
                    <button
                      type="button"
                      className="font-mono underline hover:opacity-80"
                      onClick={() => setValue("barcode", err.expected, { shouldDirty: true, shouldValidate: true })}
                    >
                      {err.expected}
                    </button>
                    . Podés guardar tal cual si es un código interno.
                  </div>
                )
              }
              if (/^\d{12}$/.test(v)) {
                const check = computeEAN13CheckDigit(v)
                if (check) {
                  return (
                    <p className="text-xs text-muted-foreground mt-1">
                      12 dígitos detectados. Para EAN-13 agregá dígito verificador:{" "}
                      <button
                        type="button"
                        className="font-mono underline text-primary hover:text-primary/80"
                        onClick={() => setValue("barcode", v + check, { shouldDirty: true, shouldValidate: true })}
                      >
                        {v + check}
                      </button>
                    </p>
                  )
                }
              }
              return null
            })()}
          </div>

          {/* Warranty default */}
          <div>
            <Label htmlFor="diasGarantiaDefault">Días de garantía por defecto</Label>
            <Input
              id="diasGarantiaDefault"
              type="text"
              inputMode="numeric"
              {...register("diasGarantiaDefault", {
                setValueAs: (v: string) => {
                  if (v === "" || v === null || v === undefined) return null
                  const n = parseInt(v, 10)
                  return isNaN(n) ? null : n
                },
              })}
              min={0}
              placeholder="Usa el default de la organización"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Días de garantía pre-cargados al agregar este producto en el POS. Dejalo vacío para usar el valor de la organización.
            </p>
          </div>

          {/* Tracking avanzado — opt-in por item */}
          <details className="border rounded-md">
            <summary className="cursor-pointer text-sm font-medium px-3 py-2 hover:bg-muted/40">
              Tracking avanzado
            </summary>
            <div className="p-3 space-y-2 border-t">
              <p className="text-xs text-muted-foreground">
                Activá sólo las features que vas a usar. Cada una habilita su dialog en el menú del item.
              </p>
              <label className="flex items-center justify-between gap-3 p-2 rounded hover:bg-muted/30 cursor-pointer">
                <div>
                  <div className="text-sm">Trackear lotes / vencimientos</div>
                  <div className="text-[11px] text-muted-foreground">Cada entrada asocia un # de lote y fecha de vencimiento.</div>
                </div>
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  {...register("trackeaLotes")}
                />
              </label>
              <label className="flex items-center justify-between gap-3 p-2 rounded hover:bg-muted/30 cursor-pointer">
                <div>
                  <div className="text-sm">Trackear números de serie</div>
                  <div className="text-[11px] text-muted-foreground">1 fila por unidad con S/N único. Útil para garantías.</div>
                </div>
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  {...register("trackeaSeries")}
                />
              </label>
              <label className="flex items-center justify-between gap-3 p-2 rounded hover:bg-muted/30 cursor-pointer">
                <div>
                  <div className="text-sm">Tiene variantes</div>
                  <div className="text-[11px] text-muted-foreground">Color/talle/capacidad con stock + precio + barcode propios.</div>
                </div>
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  {...register("tieneVariantes")}
                />
              </label>
              <label className="flex items-center justify-between gap-3 p-2 rounded hover:bg-muted/30 cursor-pointer">
                <div>
                  <div className="text-sm">Es kit / combo</div>
                  <div className="text-[11px] text-muted-foreground">Item compuesto por N componentes con cantidades.</div>
                </div>
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  {...register("esKit")}
                />
              </label>
              {watch("esKit") && (
                <div className="pl-3">
                  <Label className="text-xs">Tipo de kit</Label>
                  <Select
                    value={watch("tipoKit") ?? "ENSAMBLADO"}
                    onValueChange={(v) => setValue("tipoKit", v as "ENSAMBLADO" | "VIRTUAL", { shouldDirty: true })}
                  >
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ENSAMBLADO">Ensamblado (stock propio)</SelectItem>
                      <SelectItem value="VIRTUAL">Virtual (descuenta componentes)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </details>

          <FormActionBar className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading || uploadingImage || (!item && !generatedCode)}>
              {uploadingImage ? "Subiendo imagen..." : loading ? "Guardando..." : "Guardar"}
            </Button>
          </FormActionBar>
        </form>
      </CardContent>
    </Card>
  )
}
