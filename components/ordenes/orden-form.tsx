"use client"

import { useState, useEffect, useRef, useMemo } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DatePicker } from "@/components/ui/date-picker"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { X, Plus, Camera, Upload, Trash2, Loader2, Lock, Grid3X3 } from "lucide-react"
import { PatternLock } from "@/components/ui/pattern-lock"
import { OrdenCreadaModal } from "./orden-creada-modal"
import { compressImage } from "@/lib/image-compression"
import { useTiposDispositivo } from "@/hooks/use-tipos-dispositivo"
import type { Cliente, TipoDispositivoConfig, CampoExtra } from "@/types"

interface FotoPreview {
  id: string
  preview: string
  file?: File
  descripcion: string
}

// Fallback config for types without config in DB
const FALLBACK_CONFIG: TipoDispositivoConfig = {
  campos: {
    imei: { visible: true, label: "Numero de Serie", placeholder: "S/N del equipo" },
    password: { visible: false },
    color: { visible: true },
    marca: { visible: true },
  },
  camposExtra: [],
  accesorios: [
    { id: "cable_poder", label: "Cable de poder" },
    { id: "cargador", label: "Cargador/Fuente" },
    { id: "cable_datos", label: "Cable de datos" },
    { id: "control_remoto", label: "Control remoto" },
    { id: "manual", label: "Manual" },
    { id: "caja_original", label: "Caja original" },
  ],
  problemasComunes: [
    "No enciende", "No funciona correctamente", "Hace ruido extrano",
    "Se apaga solo", "Error en pantalla/display", "No conecta a red/WiFi",
    "Mantenimiento preventivo", "Revision general",
  ],
  marcas: [],
}

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

const ordenSchema = z.object({
  clienteId: z.string().min(1, "El cliente es requerido"),
  dispositivo: z.string().min(1, "El dispositivo es requerido"),
  tipoDispositivo: z.string().min(1, "El tipo de dispositivo es requerido"),
  marca: z.string().optional(),
  color: z.string().optional(),
  imei: z.string().optional().or(z.literal("")),
  problemaReportado: z.string().min(1, "El problema es requerido"),
  accesorios: z.string().optional(),
  codigoAccesoDispositivo: z.string().optional(),
  presupuesto: z.union([z.number().positive(), z.nan(), z.undefined()]).optional(),
  fechaPrometida: z.string().optional(),
  observaciones: z.string().optional(),
})

type OrdenFormData = z.infer<typeof ordenSchema>
type ClienteFormData = z.infer<typeof clienteSchema>

interface OrdenFormProps {
  onClose: () => void
  onSuccess: () => void
}

interface OrdenCreadaData {
  id: string
  numeroOrden: number
  dispositivo: string
  problemaReportado: string
  presupuesto?: number | null
  fechaPrometida?: string | null
  publicToken?: string | null
  cliente: {
    nombre: string
    telefono: string
  }
  organizationName?: string
}

export function OrdenForm({ onClose, onSuccess }: OrdenFormProps) {
  const [loading, setLoading] = useState(false)
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [showClienteModal, setShowClienteModal] = useState(false)
  const [clienteLoading, setClienteLoading] = useState(false)
  const [fotos, setFotos] = useState<FotoPreview[]>([])
  const [accesoriosSeleccionados, setAccesoriosSeleccionados] = useState<string[]>([])
  const [otroAccesorio, setOtroAccesorio] = useState("")
  const [passwordType, setPasswordType] = useState<"text" | "pattern">("text")
  const [showOrdenCreadaModal, setShowOrdenCreadaModal] = useState(false)
  const [ordenCreada, setOrdenCreada] = useState<OrdenCreadaData | null>(null)
  const [presupuestoAceptado, setPresupuestoAceptado] = useState(false)
  const [sena, setSena] = useState<number | undefined>(undefined)
  const [comprimiendo, setComprimiendo] = useState(false)
  const [camposExtraValues, setCamposExtraValues] = useState<Record<string, any>>({})
  const [selectedSectorId, setSelectedSectorId] = useState<string>("")
  const [sectoresCliente, setSectoresCliente] = useState<Array<{ id: string; nombre: string }>>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const { tipos: tiposDispositivo, loading: tiposLoading } = useTiposDispositivo()

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
  } = useForm<OrdenFormData>({
    resolver: zodResolver(ordenSchema),
    defaultValues: {
      clienteId: "",
      dispositivo: "",
      tipoDispositivo: "CELULAR",
      marca: "",
      color: "",
      imei: "",
      problemaReportado: "",
      accesorios: "",
      codigoAccesoDispositivo: "",
      fechaPrometida: "",
    },
  })

  const tipoDispositivo = watch("tipoDispositivo")

  // Get the selected tipo object and its config
  const tipoSeleccionado = useMemo(
    () => tiposDispositivo.find((t) => t.codigo === tipoDispositivo),
    [tiposDispositivo, tipoDispositivo]
  )
  const config: TipoDispositivoConfig = tipoSeleccionado?.config && Object.keys(tipoSeleccionado.config).length > 0
    ? tipoSeleccionado.config
    : FALLBACK_CONFIG

  // Derived from config
  const accesoriosDisponibles = config.accesorios || FALLBACK_CONFIG.accesorios!
  const problemasComunes = config.problemasComunes || FALLBACK_CONFIG.problemasComunes!
  const marcasDisponibles = config.marcas || []
  const camposExtra = config.camposExtra || []
  const showImei = config.campos?.imei?.visible !== false
  const showPassword = config.campos?.password?.visible !== false
  const showColor = config.campos?.color?.visible !== false
  const showMarca = config.campos?.marca?.visible !== false
  const imeiLabel = config.campos?.imei?.label || "Numero de Serie"
  const imeiPlaceholder = config.campos?.imei?.placeholder || "S/N del equipo"
  const imeiMaxLength = config.campos?.imei?.maxLength

  // Handle campo extra changes with autoMarca and usarComoDispositivo support
  const handleCampoExtraChange = (campo: CampoExtra, value: any) => {
    setCamposExtraValues((prev) => ({ ...prev, [campo.key]: value }))

    // If this field replaces the device name
    if (campo.usarComoDispositivo && typeof value === "string") {
      setValue("dispositivo", value)
    }

    // Auto-fill brand based on keywords in value
    if (campo.autoMarca && typeof value === "string") {
      for (const [keyword, brand] of Object.entries(campo.autoMarca)) {
        if (value.includes(keyword)) {
          setValue("marca", brand)
          break
        }
      }
    }
  }

  // Clear fields when device type changes
  const handleTipoChange = (nuevoTipo: string) => {
    setValue("tipoDispositivo", nuevoTipo)
    setAccesoriosSeleccionados([])
    setCamposExtraValues({})
    // If new type has a usarComoDispositivo field, clear dispositivo so it gets set by the field
    const nuevoTipoObj = tiposDispositivo.find((t) => t.codigo === nuevoTipo)
    const nuevoConfig = nuevoTipoObj?.config
    const hasUsarComoDispositivo = nuevoConfig?.camposExtra?.some((c) => c.usarComoDispositivo)
    if (hasUsarComoDispositivo) {
      setValue("dispositivo", "")
    }
  }

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

  const fetchClientes = async () => {
    try {
      const res = await fetch("/api/clientes?limit=100", { cache: "no-store" })
      const data = await res.json()
      const items = data.data ?? (Array.isArray(data) ? data : [])
      setClientes(items)
      return items
    } catch (error) {
      console.error("Error fetching clientes:", error)
      return []
    }
  }

  useEffect(() => {
    fetchClientes()
  }, [])

  // Fetch sectors when client changes
  const clienteId = watch("clienteId")
  const clienteSeleccionadoObj = useMemo(
    () => clientes.find((c) => c.id === clienteId),
    [clientes, clienteId]
  )

  useEffect(() => {
    setSelectedSectorId("")
    setSectoresCliente([])
    if (!clienteId || clienteSeleccionadoObj?.tipoCliente !== "EMPRESA") return

    const fetchSectores = async () => {
      try {
        const res = await fetch(`/api/clientes/${clienteId}/sectores`)
        if (res.ok) {
          const data = await res.json()
          setSectoresCliente(data)
        }
      } catch (error) {
        console.error("Error fetching sectores:", error)
      }
    }
    fetchSectores()
  }, [clienteId, clienteSeleccionadoObj?.tipoCliente])

  // Manejar seleccion de fotos
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    const fileArray = Array.from(files)

    if (fileInputRef.current) fileInputRef.current.value = ""
    if (cameraInputRef.current) cameraInputRef.current.value = ""

    setComprimiendo(true)

    const processFile = async (file: File): Promise<FotoPreview | null> => {
      if (!file.type.startsWith("image/")) {
        alert("Por favor selecciona imagenes validas")
        return null
      }

      try {
        const compressedFile = await compressImage(file)

        return new Promise((resolve) => {
          const reader = new FileReader()
          reader.onloadend = () => {
            resolve({
              id: Math.random().toString(36).substr(2, 9),
              preview: reader.result as string,
              file: compressedFile,
              descripcion: "",
            })
          }
          reader.onerror = () => resolve(null)
          reader.readAsDataURL(compressedFile)
        })
      } catch (error) {
        console.error("Error procesando imagen:", error)
        alert("Error al procesar una imagen")
        return null
      }
    }

    try {
      const results = await Promise.all(fileArray.map(processFile))
      const validPhotos = results.filter((p): p is FotoPreview => p !== null)

      if (validPhotos.length > 0) {
        setFotos((prev) => [...prev, ...validPhotos])
      }
    } finally {
      setComprimiendo(false)
    }
  }

  const removeFoto = (id: string) => {
    setFotos((prev) => prev.filter((f) => f.id !== id))
  }

  const updateFotoDescripcion = (id: string, descripcion: string) => {
    setFotos((prev) =>
      prev.map((f) => (f.id === id ? { ...f, descripcion } : f))
    )
  }

  const toggleAccesorio = (id: string) => {
    setAccesoriosSeleccionados((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    )
  }

  const addOtroAccesorio = () => {
    if (otroAccesorio.trim()) {
      setAccesoriosSeleccionados((prev) => [...prev, otroAccesorio.trim()])
      setOtroAccesorio("")
    }
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
        alert(error.error || "Error al crear cliente")
        return
      }

      const nuevoCliente = await res.json()

      setClientes(prev => [...prev, nuevoCliente])
      setValue("clienteId", nuevoCliente.id)

      setShowClienteModal(false)
      clienteForm.reset()
    } catch (error) {
      console.error("Error creating cliente:", error)
      alert("Error al crear cliente")
    } finally {
      setClienteLoading(false)
    }
  }

  // Render a dynamic extra field based on its config
  const renderCampoExtra = (campo: CampoExtra) => {
    const value = camposExtraValues[campo.key] ?? ""

    switch (campo.tipo) {
      case "text":
        return (
          <div key={campo.key}>
            <Label className="text-xs">{campo.label}</Label>
            <Input
              value={value}
              onChange={(e) => handleCampoExtraChange(campo, e.target.value)}
              placeholder={campo.placeholder || ""}
              className="h-9"
            />
          </div>
        )

      case "select":
        return (
          <div key={campo.key}>
            <Label className="text-xs">{campo.label}</Label>
            <Select
              value={value || ""}
              onValueChange={(v) => handleCampoExtraChange(campo, v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar..." />
              </SelectTrigger>
              <SelectContent>
                {(campo.opciones || []).map((op) => (
                  <SelectItem key={op} value={op}>{op}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )

      case "buttons":
        return (
          <div key={campo.key}>
            <Label className="text-xs">{campo.label}</Label>
            <div className="flex flex-wrap gap-1 mt-1">
              {(campo.opciones || []).map((op) => (
                <button
                  key={op}
                  type="button"
                  onClick={() => handleCampoExtraChange(campo, op)}
                  className={`px-2 py-1 text-xs rounded border transition-colors ${
                    value === op
                      ? "bg-primary text-primary-foreground border-primary"
                      : "hover:bg-muted"
                  }`}
                >
                  {op}
                </button>
              ))}
            </div>
          </div>
        )

      case "counter":
        return (
          <div key={campo.key}>
            <Label className="text-xs">{campo.label}</Label>
            <div className="flex gap-1 mt-1">
              {Array.from(
                { length: (campo.max ?? 4) - (campo.min ?? 0) + 1 },
                (_, i) => (campo.min ?? 0) + i
              ).map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => handleCampoExtraChange(campo, num)}
                  className={`w-10 h-10 rounded border font-medium transition-colors ${
                    value === num
                      ? "bg-primary text-primary-foreground border-primary"
                      : "hover:bg-muted"
                  }`}
                >
                  {num}
                </button>
              ))}
            </div>
          </div>
        )

      default:
        return null
    }
  }

  const onSubmit = async (data: OrdenFormData) => {
    setLoading(true)
    try {
      // Build accessories labels
      const accesoriosLabels = accesoriosSeleccionados.map((id) => {
        const acc = accesoriosDisponibles.find((a) => a.id === id)
        return acc ? acc.label : id
      })

      // Prepare photos
      const fotosData = fotos.map((foto) => {
        const base64Match = foto.preview.match(/^data:(image\/[a-z]+);base64,(.+)$/)
        return {
          data: base64Match ? base64Match[2] : "",
          mime: base64Match ? base64Match[1] : "image/jpeg",
          descripcion: foto.descripcion || undefined,
          tipo: "INGRESO",
        }
      })

      // Build metadata from camposExtra values (non-empty only)
      const metadata: Record<string, any> = {}
      for (const [key, val] of Object.entries(camposExtraValues)) {
        if (val !== "" && val !== undefined && val !== null) {
          metadata[key] = val
        }
      }

      const res = await fetch("/api/ordenes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          accesorios: accesoriosLabels.length > 0 ? accesoriosLabels.join(", ") : undefined,
          presupuesto: data.presupuesto && data.presupuesto > 0 ? data.presupuesto : undefined,
          fechaPrometida: data.fechaPrometida || undefined,
          fotos: fotosData.length > 0 ? fotosData : undefined,
          presupuestoAceptado: presupuestoAceptado,
          sena: presupuestoAceptado && sena ? sena : undefined,
          observaciones: data.observaciones || undefined,
          metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
          sectorId: selectedSectorId || undefined,
        }),
      })

      if (!res.ok) {
        const error = await res.json()
        alert(error.error || "Error al crear orden")
        return
      }

      const nuevaOrden = await res.json()

      const clienteSeleccionado = clientes.find(c => c.id === data.clienteId)

      setOrdenCreada({
        id: nuevaOrden.id,
        numeroOrden: nuevaOrden.numeroOrden,
        dispositivo: data.dispositivo,
        problemaReportado: data.problemaReportado,
        presupuesto: data.presupuesto && data.presupuesto > 0 ? data.presupuesto : null,
        fechaPrometida: data.fechaPrometida || null,
        publicToken: nuevaOrden.publicToken || null,
        cliente: {
          nombre: clienteSeleccionado?.nombre || "",
          telefono: clienteSeleccionado?.telefono || "",
        },
        organizationName: nuevaOrden.organizationName || undefined,
      })
      setShowOrdenCreadaModal(true)
    } catch (error) {
      console.error("Error creating orden:", error)
      alert("Error al crear orden")
    } finally {
      setLoading(false)
    }
  }

  // Check if the selected type has a campo extra with usarComoDispositivo
  const campoDispositivo = camposExtra.find((c) => c.usarComoDispositivo)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Nueva Orden de Servicio</CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <Label htmlFor="clienteId">Cliente *</Label>
            <div className="flex gap-2">
              <Select
                value={watch("clienteId") || ""}
                onValueChange={(value) => setValue("clienteId", value)}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Seleccionar cliente..." />
                </SelectTrigger>
                <SelectContent>
                  {clientes.map((cliente) => (
                    <SelectItem key={cliente.id} value={cliente.id}>
                      {cliente.nombre} - {cliente.telefono}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            {errors.clienteId && (
              <p className="text-sm text-destructive mt-1">
                {errors.clienteId.message}
              </p>
            )}
          </div>

          {/* Sector selector for empresa clients */}
          {clienteSeleccionadoObj?.tipoCliente === "EMPRESA" && sectoresCliente.length > 0 && (
            <div>
              <Label>Sector</Label>
              <Select
                value={selectedSectorId}
                onValueChange={setSelectedSectorId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar sector..." />
                </SelectTrigger>
                <SelectContent>
                  {sectoresCliente.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {clienteSeleccionadoObj.razonSocial && (
                <p className="text-xs text-muted-foreground mt-1">
                  Empresa: {clienteSeleccionadoObj.razonSocial}
                  {clienteSeleccionadoObj.cuit && ` - CUIT: ${clienteSeleccionadoObj.cuit}`}
                </p>
              )}
            </div>
          )}

          {/* Tipo de dispositivo con selector visual */}
          <div>
            <Label>Tipo de Dispositivo *</Label>
            {tiposLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className={`grid gap-2 mt-2 ${
                tiposDispositivo.length <= 5
                  ? "grid-cols-3 sm:grid-cols-5"
                  : tiposDispositivo.length <= 8
                  ? "grid-cols-3 sm:grid-cols-4"
                  : "grid-cols-3 sm:grid-cols-4 lg:grid-cols-5"
              }`}>
                {tiposDispositivo.map((tipo) => (
                  <button
                    key={tipo.codigo}
                    type="button"
                    onClick={() => handleTipoChange(tipo.codigo)}
                    className={`flex flex-col items-center justify-center p-3 border rounded-lg transition-all ${
                      tipoDispositivo === tipo.codigo
                        ? "bg-primary text-primary-foreground border-primary shadow-md scale-105"
                        : "hover:bg-muted hover:border-primary/50"
                    }`}
                  >
                    <span className="text-xs font-medium truncate w-full text-center">{tipo.nombre}</span>
                  </button>
                ))}
              </div>
            )}
            {errors.tipoDispositivo && (
              <p className="text-sm text-destructive mt-1">
                {errors.tipoDispositivo.message}
              </p>
            )}
          </div>

          {/* Dispositivo - Use select if a campoExtra has usarComoDispositivo, otherwise text input */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="dispositivo">
                {campoDispositivo ? campoDispositivo.label + " *" : "Dispositivo *"}
              </Label>
              {campoDispositivo ? (
                <Select
                  value={watch("dispositivo") || ""}
                  onValueChange={(value) => handleCampoExtraChange(campoDispositivo, value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(campoDispositivo.opciones || []).map((op) => (
                      <SelectItem key={op} value={op}>{op}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="dispositivo"
                  {...register("dispositivo")}
                  placeholder="Modelo o descripcion del equipo"
                />
              )}
              {errors.dispositivo && (
                <p className="text-sm text-destructive mt-1">
                  {errors.dispositivo.message}
                </p>
              )}
            </div>

            {/* Marca with quick select */}
            {showMarca && (
              <div>
                <Label htmlFor="marca">Marca</Label>
                <div className="space-y-2">
                  <Input
                    id="marca"
                    {...register("marca")}
                    placeholder="Ej: Apple, Samsung"
                  />
                  {marcasDisponibles.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {marcasDisponibles.slice(0, 5).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setValue("marca", m)}
                          className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                            watch("marca") === m
                              ? "bg-primary text-primary-foreground border-primary"
                              : "hover:bg-muted"
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Dynamic extra fields from config */}
          {camposExtra.filter((c) => !c.usarComoDispositivo).length > 0 && (
            <div className={`border rounded-lg p-4 space-y-4 ${
              config.infoSectionColor === "blue" ? "bg-blue-50/30 dark:bg-blue-950/20" :
              config.infoSectionColor === "purple" ? "bg-purple-50/30 dark:bg-purple-950/20" :
              "bg-muted/30"
            }`}>
              <h4 className="font-medium text-sm flex items-center gap-2">
                {config.infoSectionIcon && <span>{config.infoSectionIcon}</span>}
                {config.infoSectionTitle || "Informacion Adicional"}
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {camposExtra.filter((c) => !c.usarComoDispositivo).map(renderCampoExtra)}
              </div>
            </div>
          )}

          {/* Color and IMEI/Serial - driven by config visibility */}
          {(showColor || showImei) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {showColor && (
                <div>
                  <Label htmlFor="color">Color</Label>
                  <Input
                    id="color"
                    {...register("color")}
                    placeholder="Ej: Negro, Azul"
                  />
                </div>
              )}
              {showImei && (
                <div>
                  <Label htmlFor="imei">{imeiLabel}</Label>
                  <Input
                    id="imei"
                    {...register("imei")}
                    placeholder={imeiPlaceholder}
                    maxLength={imeiMaxLength}
                  />
                  {errors.imei && (
                    <p className="text-sm text-destructive mt-1">
                      {errors.imei.message}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Problema reportado con seleccion rapida */}
          <div>
            <Label htmlFor="problemaReportado">Problema Reportado *</Label>
            {problemasComunes.length > 0 && (
              <div className="mb-2">
                <p className="text-xs text-muted-foreground mb-1">Problemas comunes (clic para agregar):</p>
                <div className="flex flex-wrap gap-1">
                  {problemasComunes.map((problema) => (
                    <button
                      key={problema}
                      type="button"
                      onClick={() => {
                        const currentValue = watch("problemaReportado") || ""
                        const newValue = currentValue
                          ? `${currentValue}${currentValue.endsWith(".") || currentValue.endsWith("\n") ? " " : ". "}${problema}`
                          : problema
                        setValue("problemaReportado", newValue)
                      }}
                      className="px-2 py-1 text-xs rounded-full border bg-background hover:bg-primary hover:text-primary-foreground transition-colors"
                    >
                      {problema}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <Textarea
              id="problemaReportado"
              {...register("problemaReportado")}
              placeholder="Describa el problema del equipo..."
              rows={3}
            />
            {errors.problemaReportado && (
              <p className="text-sm text-destructive mt-1">
                {errors.problemaReportado.message}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="presupuesto">Presupuesto (Opcional)</Label>
              <Input
                id="presupuesto"
                type="number"
                step="0.01"
                min="0"
                {...register("presupuesto", {
                  valueAsNumber: true,
                  setValueAs: (value) => value === "" || value === null || value === undefined ? undefined : Number(value)
                })}
                placeholder="0.00"
              />
            </div>
            <DatePicker
              id="fechaPrometida"
              label="Fecha Prometida (Opcional)"
              value={watch("fechaPrometida")}
              onChange={(value) => setValue("fechaPrometida", value || "")}
              min={new Date().toISOString().split("T")[0]}
            />
          </div>

          {/* Presupuesto aceptado al momento */}
          {watch("presupuesto") && watch("presupuesto")! > 0 && (
            <div className="border rounded-lg p-4 bg-green-50/50">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={presupuestoAceptado}
                  onChange={(e) => {
                    setPresupuestoAceptado(e.target.checked)
                    if (!e.target.checked) setSena(undefined)
                  }}
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <div>
                  <span className="font-medium text-green-700">
                    Presupuesto aceptado al momento
                  </span>
                  <p className="text-xs text-muted-foreground">
                    El cliente acepta el precio y deja el equipo para reparacion
                  </p>
                </div>
              </label>

              {presupuestoAceptado && (
                <div className="mt-4 pl-7">
                  <Label htmlFor="sena">Sena / Adelanto (Opcional)</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-muted-foreground">$</span>
                    <Input
                      id="sena"
                      type="number"
                      step="0.01"
                      min="0"
                      max={watch("presupuesto") || undefined}
                      value={sena || ""}
                      onChange={(e) => setSena(e.target.value ? Number(e.target.value) : undefined)}
                      placeholder="0.00"
                      className="w-40"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Monto que el cliente deja como anticipo
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Accesorios recibidos - dynamic from config */}
          <div>
            <Label>Accesorios Recibidos</Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
              {accesoriosDisponibles.map((acc) => (
                <label
                  key={acc.id}
                  className={`flex items-center gap-2 p-2 border rounded cursor-pointer transition-colors ${
                    accesoriosSeleccionados.includes(acc.id)
                      ? "bg-primary/10 border-primary"
                      : "hover:bg-muted"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={accesoriosSeleccionados.includes(acc.id)}
                    onChange={() => toggleAccesorio(acc.id)}
                    className="sr-only"
                  />
                  <div
                    className={`w-4 h-4 border rounded flex items-center justify-center ${
                      accesoriosSeleccionados.includes(acc.id)
                        ? "bg-primary border-primary text-white"
                        : "border-gray-300"
                    }`}
                  >
                    {accesoriosSeleccionados.includes(acc.id) && (
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </div>
                  <span className="text-sm">{acc.label}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2 mt-2">
              <Input
                value={otroAccesorio}
                onChange={(e) => setOtroAccesorio(e.target.value)}
                placeholder="Otro accesorio..."
                className="flex-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    addOtroAccesorio()
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addOtroAccesorio}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {accesoriosSeleccionados.filter((a) => !accesoriosDisponibles.find((c) => c.id === a)).length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {accesoriosSeleccionados
                  .filter((a) => !accesoriosDisponibles.find((c) => c.id === a))
                  .map((acc) => (
                    <span
                      key={acc}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary rounded text-sm"
                    >
                      {acc}
                      <button
                        type="button"
                        onClick={() => toggleAccesorio(acc)}
                        className="hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
              </div>
            )}
          </div>

          {/* Password - driven by config visibility */}
          {showPassword && <div>
            <Label>Contrasena/Patron del Dispositivo</Label>
            <div className="flex gap-1 mt-2 mb-3">
              <Button
                type="button"
                variant={passwordType === "text" ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setPasswordType("text")
                  setValue("codigoAccesoDispositivo", "")
                }}
                className="flex-1"
              >
                <Lock className="h-4 w-4 mr-2" />
                PIN / Contrasena
              </Button>
              <Button
                type="button"
                variant={passwordType === "pattern" ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setPasswordType("pattern")
                  setValue("codigoAccesoDispositivo", "")
                }}
                className="flex-1"
              >
                <Grid3X3 className="h-4 w-4 mr-2" />
                Patron
              </Button>
            </div>
            {passwordType === "text" ? (
              <Input
                id="codigoAccesoDispositivo"
                {...register("codigoAccesoDispositivo")}
                placeholder="PIN o contrasena para pruebas"
              />
            ) : (
              <PatternLock
                value={watch("codigoAccesoDispositivo")}
                onChange={(pattern) => setValue("codigoAccesoDispositivo", pattern)}
              />
            )}
            <p className="text-xs text-muted-foreground mt-2">
              Solo si es necesario para realizar pruebas
            </p>
          </div>}

          {/* Fotos de ingreso */}
          <div>
            <Label>Fotos del Equipo (Ingreso)</Label>
            <div className="mt-2 space-y-3">
              <div className="flex gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleFileChange}
                  className="hidden"
                />
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1"
                  disabled={comprimiendo}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Seleccionar archivos
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => cameraInputRef.current?.click()}
                  className="flex-1"
                  disabled={comprimiendo}
                >
                  <Camera className="mr-2 h-4 w-4" />
                  Tomar foto
                </Button>
              </div>

              {comprimiendo && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Comprimiendo imagenes...
                </div>
              )}

              {fotos.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {fotos.map((foto) => (
                    <div key={foto.id} className="relative group">
                      <img
                        src={foto.preview}
                        alt="Preview"
                        className="w-full h-24 object-cover rounded-lg border"
                      />
                      <button
                        type="button"
                        onClick={() => removeFoto(foto.id)}
                        className="absolute top-1 right-1 p-1 bg-destructive text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                      <Input
                        value={foto.descripcion}
                        onChange={(e) => updateFotoDescripcion(foto.id, e.target.value)}
                        placeholder="Descripcion..."
                        className="mt-1 text-xs h-7"
                      />
                    </div>
                  ))}
                </div>
              )}

              {fotos.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4 border-2 border-dashed rounded-lg">
                  Agregar fotos del estado inicial del equipo
                </p>
              )}
            </div>
          </div>

          <div>
            <Label htmlFor="observaciones">Observaciones</Label>
            <Textarea
              id="observaciones"
              {...register("observaciones")}
              placeholder="Observaciones adicionales..."
              rows={2}
            />
          </div>

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Creando..." : "Crear Orden"}
            </Button>
          </div>
        </form>
      </CardContent>

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
              <Label htmlFor="cliente-telefono">Telefono *</Label>
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
              <Label htmlFor="cliente-direccion">Direccion</Label>
              <Input
                id="cliente-direccion"
                {...clienteForm.register("direccion")}
                placeholder="Direccion completa"
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
                {clienteLoading ? "Creando..." : "Crear Cliente"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal de orden creada con WhatsApp */}
      <OrdenCreadaModal
        open={showOrdenCreadaModal}
        onClose={() => {
          setShowOrdenCreadaModal(false)
          setOrdenCreada(null)
          onSuccess()
        }}
        orden={ordenCreada}
      />
    </Card>
  )
}
