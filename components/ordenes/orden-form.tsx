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
import { X, Plus, Camera, Upload, Trash2, Loader2, Lock, Grid3X3, ClipboardCheck, ChevronDown, ChevronUp } from "lucide-react"
import { PatternLock } from "@/components/ui/pattern-lock"
import { OrdenCreadaModal } from "./orden-creada-modal"
import { compressImage } from "@/lib/image-compression"
import { useTiposDispositivo } from "@/hooks/use-tipos-dispositivo"
import { SignaturePad } from "@/components/firma/signature-pad"
import { useOffline } from "@/contexts/offline-context"
import { STORES } from "@/lib/offline/constants"
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

const clienteSchemaIndividual = z.object({
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
  razonSocial: z.string().optional(),
  cuit: z.string().optional(),
})

const clienteSchemaEmpresa = z.object({
  nombre: z.string().min(1, "El nombre es requerido"),
  telefono: z.string()
    .min(1, "El teléfono es requerido")
    .regex(/^\d{10}$/, "El teléfono debe tener exactamente 10 dígitos"),
  email: z.string().email("Email inválido").optional().or(z.literal("")),
  direccion: z.string().optional(),
  dni: z.string().optional().or(z.literal("")),
  razonSocial: z.string().min(1, "La razón social es requerida"),
  cuit: z.string().optional().or(z.literal("")),
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
type ClienteFormData = z.infer<typeof clienteSchemaIndividual>

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
  const { offlineFetch } = useOffline()
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
  const [metodoPagoSena, setMetodoPagoSena] = useState<string>("EFECTIVO")
  const [comprimiendo, setComprimiendo] = useState(false)
  const [camposExtraValues, setCamposExtraValues] = useState<Record<string, any>>({})
  const [selectedSectorId, setSelectedSectorId] = useState<string>("")
  const [sectoresCliente, setSectoresCliente] = useState<Array<{ id: string; nombre: string }>>([])
  const [nuevoClienteTipo, setNuevoClienteTipo] = useState<"INDIVIDUAL" | "EMPRESA">("INDIVIDUAL")
  const [nuevoSectorNombre, setNuevoSectorNombre] = useState("")
  const [crearSectorLoading, setCrearSectorLoading] = useState(false)
  const [checklistTemplate, setChecklistTemplate] = useState<any>(null)
  const [checklistValores, setChecklistValores] = useState<Record<string, boolean | string | null>>({})
  const [checklistNotas, setChecklistNotas] = useState("")
  const [checklistFirma, setChecklistFirma] = useState<string | null>(null)
  const [checklistFirmaMime, setChecklistFirmaMime] = useState<string | null>(null)
  const [checklistOpen, setChecklistOpen] = useState(true)
  const [currentStep, setCurrentStep] = useState(1)
  const totalSteps = 3
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const { tipos: tiposDispositivo, loading: tiposLoading } = useTiposDispositivo()

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
    trigger,
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
    defaultValues: {
      nombre: "",
      telefono: "",
      email: "",
      direccion: "",
      dni: "",
      razonSocial: "",
      cuit: "",
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

  // Fetch checklist template when device type changes
  useEffect(() => {
    const fetchChecklistTemplate = async () => {
      const tipoId = tipoSeleccionado?.id
      try {
        const url = tipoId
          ? `/api/checklist-templates/by-device-type?tipoDispositivoId=${tipoId}`
          : `/api/checklist-templates/by-device-type`
        const res = await fetch(url)
        if (res.ok) {
          const data = await res.json()
          setChecklistTemplate(data.template)
          setChecklistValores({})
          setChecklistNotas("")
          setChecklistFirma(null)
          setChecklistFirmaMime(null)
        }
      } catch (error) {
        console.error("Error fetching checklist template:", error)
      }
    }
    fetchChecklistTemplate()
  }, [tipoSeleccionado?.id])

  // Fetch sectors when client changes
  const clienteId = watch("clienteId")
  const clienteSeleccionadoObj = useMemo(
    () => clientes.find((c) => c.id === clienteId),
    [clientes, clienteId]
  )

  const esClienteEmpresa = clienteSeleccionadoObj?.tipoCliente === "EMPRESA" || !!clienteSeleccionadoObj?.razonSocial

  // DEBUG: remover después
  useEffect(() => {
    if (clienteSeleccionadoObj) {
      console.log("Cliente seleccionado:", {
        id: clienteSeleccionadoObj.id,
        nombre: clienteSeleccionadoObj.nombre,
        tipoCliente: clienteSeleccionadoObj.tipoCliente,
        razonSocial: clienteSeleccionadoObj.razonSocial,
        esClienteEmpresa,
      })
    }
  }, [clienteSeleccionadoObj, esClienteEmpresa])

  useEffect(() => {
    setSelectedSectorId("")
    setSectoresCliente([])
    if (!clienteId || !esClienteEmpresa) return

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
  }, [clienteId, esClienteEmpresa])

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
    // Validate with the right schema based on tipo
    const schema = nuevoClienteTipo === "EMPRESA" ? clienteSchemaEmpresa : clienteSchemaIndividual
    const result = schema.safeParse(data)
    if (!result.success) {
      // Set errors manually
      for (const issue of result.error.issues) {
        const field = issue.path[0] as keyof ClienteFormData
        clienteForm.setError(field, { message: issue.message })
      }
      return
    }

    setClienteLoading(true)
    try {
      const res = await fetch("/api/clientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...result.data,
          tipoCliente: nuevoClienteTipo,
          razonSocial: nuevoClienteTipo === "EMPRESA" ? result.data.razonSocial : undefined,
          cuit: nuevoClienteTipo === "EMPRESA" ? result.data.cuit : undefined,
        }),
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
      setNuevoClienteTipo("INDIVIDUAL")
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

  const handleCrearSector = async () => {
    if (!nuevoSectorNombre.trim() || !clienteId) return
    setCrearSectorLoading(true)
    try {
      const res = await fetch(`/api/clientes/${clienteId}/sectores`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: nuevoSectorNombre.trim() }),
      })
      if (res.ok) {
        const sector = await res.json()
        setSectoresCliente((prev) => [...prev, sector])
        setSelectedSectorId(sector.id)
        setNuevoSectorNombre("")
      } else {
        const err = await res.json()
        alert(err.error || "Error al crear sector")
      }
    } catch (e) {
      console.error("Error creating sector:", e)
    } finally {
      setCrearSectorLoading(false)
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

      const ordenPayload = {
        ...data,
        accesorios: accesoriosLabels.length > 0 ? accesoriosLabels.join(", ") : undefined,
        presupuesto: data.presupuesto && data.presupuesto > 0 ? data.presupuesto : undefined,
        fechaPrometida: data.fechaPrometida || undefined,
        fotos: fotosData.length > 0 ? fotosData : undefined,
        presupuestoAceptado: presupuestoAceptado,
        sena: presupuestoAceptado && sena ? sena : undefined,
        metodoPagoSena: presupuestoAceptado && sena ? metodoPagoSena : undefined,
        observaciones: data.observaciones || undefined,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        sectorId: selectedSectorId || undefined,
      }

      const res = await offlineFetch("/api/ordenes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ordenPayload),
      }, { store: STORES.ORDERS, description: `Orden - ${data.dispositivo}` })

      if (res.status === 202) {
        // Queued offline
        const clienteSeleccionado = clientes.find(c => c.id === data.clienteId)
        alert("Orden guardada offline. Se sincronizará automáticamente cuando vuelva la conexión.")
        onSuccess?.()
        onClose()
        return
      }

      if (!res.ok) {
        const error = await res.json()
        alert(error.error || "Error al crear orden")
        return
      }

      const nuevaOrden = await res.json()

      // Guardar checklist si hay template y valores completados
      console.log("[CHECKLIST SAVE] template:", !!checklistTemplate, "templateId:", checklistTemplate?.id, "valores count:", Object.keys(checklistValores).length)
      if (checklistTemplate && Object.keys(checklistValores).length > 0) {
        try {
          const checklistBody = {
            templateId: checklistTemplate.id,
            valores: checklistValores,
            notas: checklistNotas || undefined,
            firmaCliente: checklistFirma || undefined,
            firmaMime: checklistFirmaMime || undefined,
          }
          console.log("[CHECKLIST SAVE] Enviando POST a /api/ordenes/" + nuevaOrden.id + "/checklist", JSON.stringify(checklistBody))
          const checklistRes = await offlineFetch(`/api/ordenes/${nuevaOrden.id}/checklist`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(checklistBody),
          }, { store: STORES.ORDERS, description: `Checklist - ${data.dispositivo}` })
          if (!checklistRes.ok) {
            const checklistErr = await checklistRes.json().catch(() => ({}))
            console.error("[CHECKLIST SAVE] Error:", checklistRes.status, JSON.stringify(checklistErr))
          } else {
            console.log("[CHECKLIST SAVE] Checklist guardado exitosamente")
          }
        } catch (checklistError) {
          console.error("[CHECKLIST SAVE] Exception:", checklistError)
        }
      } else {
        console.warn("[CHECKLIST SAVE] SKIPPED - template:", !!checklistTemplate, "valores:", Object.keys(checklistValores).length)
      }

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

  const validateStep = async (step: number): Promise<boolean> => {
    if (step === 1) {
      const result = await trigger(["clienteId", "dispositivo", "tipoDispositivo", "problemaReportado"])
      return result
    }
    return true
  }

  const handleNextStep = async () => {
    const isValid = await validateStep(currentStep)
    if (isValid) setCurrentStep((prev) => Math.min(prev + 1, totalSteps))
  }

  const handlePrevStep = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1))
  }

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
          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-6">
            {[
              { step: 1, label: "Cliente y Equipo" },
              { step: 2, label: "Detalles" },
              { step: 3, label: "Fotos y Checklist" },
            ].map(({ step, label }, index) => (
              <div key={step} className="flex items-center gap-2 flex-1">
                <button
                  type="button"
                  onClick={() => step < currentStep && setCurrentStep(step)}
                  className={`flex items-center gap-2 w-full p-2 rounded-lg text-sm font-medium transition-colors ${
                    step === currentStep
                      ? "bg-primary text-primary-foreground"
                      : step < currentStep
                      ? "bg-primary/10 text-primary cursor-pointer hover:bg-primary/20"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  <span className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold shrink-0 ${
                    step === currentStep
                      ? "bg-primary-foreground text-primary"
                      : step < currentStep
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted-foreground/20 text-muted-foreground"
                  }`}>
                    {step < currentStep ? "✓" : step}
                  </span>
                  <span className="hidden sm:inline truncate">{label}</span>
                </button>
                {index < 2 && <div className={`h-px w-4 shrink-0 ${step < currentStep ? "bg-primary" : "bg-border"}`} />}
              </div>
            ))}
          </div>

          {currentStep === 1 && (<>
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
          {esClienteEmpresa && (
            <div>
              <Label>Sector / Area</Label>
              {sectoresCliente.length > 0 ? (
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
              ) : (
                <p className="text-sm text-muted-foreground py-1">No hay sectores creados</p>
              )}
              <div className="flex gap-2 mt-2">
                <Input
                  value={nuevoSectorNombre}
                  onChange={(e) => setNuevoSectorNombre(e.target.value)}
                  placeholder="Nuevo sector (ej: Contaduria, Transito)"
                  className="flex-1"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      handleCrearSector()
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={!nuevoSectorNombre.trim() || crearSectorLoading}
                  onClick={handleCrearSector}
                >
                  {crearSectorLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </Button>
              </div>
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
          </>)}

          {currentStep === 2 && (<>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="presupuesto">Presupuesto (Opcional)</Label>
              <Input
                id="presupuesto"
                type="number"
                step="0.01"
                min="0"
                {...register("presupuesto", {
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
                  <Label htmlFor="sena">Seña / Adelanto (Opcional)</Label>
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
                  {sena && sena > 0 && (
                    <div className="mt-2">
                      <Label className="text-xs text-muted-foreground">Método de pago de la seña</Label>
                      <div className="flex gap-1.5 mt-1">
                        {[
                          { value: "EFECTIVO", label: "Efectivo" },
                          { value: "TRANSFERENCIA", label: "Transfer." },
                          { value: "MERCADOPAGO", label: "MP" },
                          { value: "OTRO", label: "Otro" },
                        ].map(({ value, label }) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setMetodoPagoSena(value)}
                            className={`px-2.5 py-1 rounded text-xs font-medium border transition-all ${
                              metodoPagoSena === value
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
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

          {/* Observaciones */}
          <div>
            <Label htmlFor="observaciones">Observaciones</Label>
            <Textarea
              id="observaciones"
              {...register("observaciones")}
              placeholder="Observaciones adicionales..."
              rows={2}
            />
          </div>
          </>)}

          {currentStep === 3 && (<>
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

          {/* Checklist de Recepción inline */}
          {checklistTemplate && checklistTemplate.items && checklistTemplate.items.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setChecklistOpen(!checklistOpen)}
                className="w-full flex items-center justify-between p-4 bg-muted/50 hover:bg-muted transition-colors"
              >
                <div className="flex items-center gap-2 font-medium">
                  <ClipboardCheck className="h-4 w-4" />
                  Checklist de Recepción
                  <span className="text-xs text-muted-foreground font-normal">
                    ({checklistTemplate.nombre})
                  </span>
                </div>
                {checklistOpen ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
              {checklistOpen && (
                <div className="p-4 space-y-4">
                  {(() => {
                    const itemsByCategory = checklistTemplate.items.reduce((acc: Record<string, any[]>, item: any) => {
                      const cat = item.categoria || "GENERAL"
                      if (!acc[cat]) acc[cat] = []
                      acc[cat].push(item)
                      return acc
                    }, {})
                    const categoriaLabels: Record<string, string> = {
                      CONDICION_FISICA: "Condición Física",
                      ACCESORIOS: "Accesorios Entregados",
                      FUNCIONAL: "Estado Funcional",
                      OTRO: "Otros",
                      GENERAL: "General",
                    }
                    return Object.entries(itemsByCategory).map(([categoria, items]) => (
                      <div key={categoria}>
                        <h4 className="text-sm font-medium text-muted-foreground border-b pb-1 mb-2">
                          {categoriaLabels[categoria] || categoria}
                        </h4>
                        <div className="space-y-1">
                          {(items as any[]).sort((a, b) => a.orden - b.orden).map((item) => {
                            const value = checklistValores[item.id]
                            if (item.tipo === "BOOLEAN") {
                              return (
                                <div key={item.id} className="flex items-center justify-between py-1.5">
                                  <span className="text-sm">
                                    {item.label}
                                    {item.requerido && <span className="text-red-500 ml-1">*</span>}
                                  </span>
                                  <div className="flex gap-1.5">
                                    <button
                                      type="button"
                                      className={`px-3 py-1 text-xs rounded border transition-colors ${
                                        value === true
                                          ? "bg-primary text-primary-foreground border-primary"
                                          : "hover:bg-muted"
                                      }`}
                                      onClick={() => setChecklistValores(prev => ({ ...prev, [item.id]: true }))}
                                    >
                                      Sí
                                    </button>
                                    <button
                                      type="button"
                                      className={`px-3 py-1 text-xs rounded border transition-colors ${
                                        value === false
                                          ? "bg-primary text-primary-foreground border-primary"
                                          : "hover:bg-muted"
                                      }`}
                                      onClick={() => setChecklistValores(prev => ({ ...prev, [item.id]: false }))}
                                    >
                                      No
                                    </button>
                                  </div>
                                </div>
                              )
                            }
                            if (item.tipo === "TEXT") {
                              return (
                                <div key={item.id} className="py-1.5">
                                  <Label className="text-sm">
                                    {item.label}
                                    {item.requerido && <span className="text-red-500 ml-1">*</span>}
                                  </Label>
                                  <Input
                                    value={(value as string) || ""}
                                    onChange={(e) => setChecklistValores(prev => ({ ...prev, [item.id]: e.target.value }))}
                                    className="h-8 mt-1"
                                  />
                                </div>
                              )
                            }
                            if (item.tipo === "SELECT") {
                              const opciones = item.opciones ? JSON.parse(item.opciones) : []
                              return (
                                <div key={item.id} className="py-1.5">
                                  <Label className="text-sm">
                                    {item.label}
                                    {item.requerido && <span className="text-red-500 ml-1">*</span>}
                                  </Label>
                                  <Select
                                    value={(value as string) || "none"}
                                    onValueChange={(val) => setChecklistValores(prev => ({ ...prev, [item.id]: val === "none" ? "" : val }))}
                                  >
                                    <SelectTrigger className="h-8 mt-1">
                                      <SelectValue placeholder="Seleccionar..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="none">Seleccionar...</SelectItem>
                                      {opciones.map((opt: string) => (
                                        <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              )
                            }
                            return null
                          })}
                        </div>
                      </div>
                    ))
                  })()}
                  <div>
                    <Label className="text-sm">Observaciones del checklist</Label>
                    <Textarea
                      value={checklistNotas}
                      onChange={(e) => setChecklistNotas(e.target.value)}
                      placeholder="Notas adicionales sobre el estado del equipo..."
                      rows={2}
                      className="mt-1"
                    />
                  </div>
                  <div className="pt-2 border-t">
                    <SignaturePad
                      label="Firma del Cliente (Conformidad de recepción)"
                      onSignatureChange={(data, mime) => {
                        setChecklistFirma(data)
                        setChecklistFirmaMime(mime)
                      }}
                      disabled={loading}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
          </>)}

          <div className="flex gap-2 justify-between">
            <div>
              {currentStep > 1 && (
                <Button type="button" variant="outline" onClick={handlePrevStep}>
                  Anterior
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              {currentStep < totalSteps ? (
                <Button type="button" onClick={handleNextStep}>
                  Siguiente
                </Button>
              ) : (
                <Button type="submit" disabled={loading}>
                  {loading ? "Creando..." : "Crear Orden"}
                </Button>
              )}
            </div>
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
            {/* Tipo de cliente toggle */}
            <div>
              <Label>Tipo de Cliente</Label>
              <div className="flex gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => { setNuevoClienteTipo("INDIVIDUAL"); clienteForm.clearErrors() }}
                  className={`flex-1 py-2 px-3 text-sm rounded-lg border transition-colors ${
                    nuevoClienteTipo === "INDIVIDUAL"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "hover:bg-muted"
                  }`}
                >
                  Individual
                </button>
                <button
                  type="button"
                  onClick={() => { setNuevoClienteTipo("EMPRESA"); clienteForm.clearErrors() }}
                  className={`flex-1 py-2 px-3 text-sm rounded-lg border transition-colors ${
                    nuevoClienteTipo === "EMPRESA"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "hover:bg-muted"
                  }`}
                >
                  Empresa
                </button>
              </div>
            </div>

            <div>
              <Label htmlFor="cliente-nombre">
                {nuevoClienteTipo === "EMPRESA" ? "Nombre de contacto *" : "Nombre *"}
              </Label>
              <Input
                id="cliente-nombre"
                {...clienteForm.register("nombre")}
                placeholder={nuevoClienteTipo === "EMPRESA" ? "Nombre del contacto principal" : "Nombre completo"}
              />
              {clienteForm.formState.errors.nombre && (
                <p className="text-sm text-destructive mt-1">
                  {clienteForm.formState.errors.nombre.message}
                </p>
              )}
            </div>

            {/* Campos empresa */}
            {nuevoClienteTipo === "EMPRESA" && (
              <>
                <div>
                  <Label htmlFor="cliente-razon-social">Razon Social *</Label>
                  <Input
                    id="cliente-razon-social"
                    {...clienteForm.register("razonSocial")}
                    placeholder="Ej: Municipalidad de Cordoba"
                  />
                  {clienteForm.formState.errors.razonSocial && (
                    <p className="text-sm text-destructive mt-1">
                      {clienteForm.formState.errors.razonSocial.message}
                    </p>
                  )}
                </div>
                <div>
                  <Label htmlFor="cliente-cuit">CUIT</Label>
                  <Input
                    id="cliente-cuit"
                    {...clienteForm.register("cuit")}
                    placeholder="30-12345678-9"
                  />
                </div>
              </>
            )}

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

            {nuevoClienteTipo === "INDIVIDUAL" && (
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
            )}

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
                  setNuevoClienteTipo("INDIVIDUAL")
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
