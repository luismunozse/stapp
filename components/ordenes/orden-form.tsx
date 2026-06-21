"use client"

import { useState, useEffect, useRef, useMemo } from "react"
import { useSession } from "next-auth/react"
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
import { FormActionBar } from "@/components/ui/form-action-bar"
import { X, Plus, Camera, Upload, Trash2, Loader2, Lock, Grid3X3, ClipboardCheck, ChevronDown, ChevronUp } from "lucide-react"
import { PatternLock } from "@/components/ui/pattern-lock"
import { ClienteSelector } from "@/components/cotizaciones/cliente-selector"
import { OrdenCreadaModal } from "./orden-creada-modal"
import { UpgradeModal } from "@/components/billing/upgrade-modal"
import { usePlanLimitError } from "@/lib/hooks/use-plan-limit-error"
import { compressImage } from "@/lib/image-compression"
import { useTiposDispositivo } from "@/hooks/use-tipos-dispositivo"
import { SignaturePad } from "@/components/firma/signature-pad"
import { useOffline } from "@/contexts/offline-context"
import { useModal } from "@/contexts/modal-context"
import { STORES } from "@/lib/offline/constants"
import type { Cliente, TipoDispositivoConfig, CampoExtra } from "@/types"
import { isValidImei, sanitizeImei } from "@/lib/imei"

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
    password: { visible: true },
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
  telefonoContacto: z.string().optional(),
  presupuesto: z.union([z.number().positive(), z.nan(), z.undefined()]).optional(),
  fechaPrometida: z.string().optional(),
  observaciones: z.string().optional(),
  notasInternas: z.string().optional(),
})

type OrdenFormData = z.infer<typeof ordenSchema>

interface OrdenFormProps {
  onClose: () => void
  onSuccess: () => void
  fromTurnoId?: string
  initialClienteId?: string
}

interface OrdenCreadaData {
  id: string
  numeroOrden: number
  codigoOrden?: string
  dispositivo: string
  problemaReportado: string
  presupuesto?: number | null
  fechaPrometida?: string | null
  publicToken?: string | null
  cliente: {
    nombre: string
    telefono: string
  }
  telefonoContacto?: string | null
  organizationName?: string
  // Campos extra para comprobante térmico
  tipoDispositivo?: string
  marca?: string | null
  color?: string | null
  imei?: string | null
  accesorios?: string | null
  observaciones?: string | null
  estado?: string
  costoFinal?: number | null
  fechaIngreso?: string | null
  clienteId?: string
  organizationLogoUrl?: string | null
  organizationTelefono?: string | null
  organizationDireccion?: string | null
  organizationComprobanteTerminos?: string | null
}

export function OrdenForm({ onClose, onSuccess, fromTurnoId, initialClienteId }: OrdenFormProps) {
  const { offlineFetch } = useOffline()
  const { showError, showInfo } = useModal()
  const { data: session } = useSession()
  const isTecnicoRole = session?.user?.role === "TECNICO"
  const [loading, setLoading] = useState(false)
  const [selectedClienteObj, setSelectedClienteObj] = useState<Cliente | null>(null)
  const [fotos, setFotos] = useState<FotoPreview[]>([])
  const [accesoriosSeleccionados, setAccesoriosSeleccionados] = useState<string[]>([])
  const [otroAccesorio, setOtroAccesorio] = useState("")
  const [passwordType, setPasswordType] = useState<"text" | "pattern">("text")
  const [showOrdenCreadaModal, setShowOrdenCreadaModal] = useState(false)
  const [ordenCreada, setOrdenCreada] = useState<OrdenCreadaData | null>(null)
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const planLimitError = usePlanLimitError()
  const [presupuestoAceptado, setPresupuestoAceptado] = useState(false)
  const [sena, setSena] = useState<number | undefined>(undefined)
  const [metodoPagoSena, setMetodoPagoSena] = useState<string>("EFECTIVO")
  const [comprimiendo, setComprimiendo] = useState(false)
  const [camposExtraValues, setCamposExtraValues] = useState<Record<string, any>>({})
  const [selectedSectorId, setSelectedSectorId] = useState<string>("")
  const [sectoresCliente, setSectoresCliente] = useState<Array<{ id: string; nombre: string }>>([])
  const [tecnicosDisponibles, setTecnicosDisponibles] = useState<Array<{ id: string; nombre: string; activo: boolean }>>([])
  const [selectedTecnicoId, setSelectedTecnicoId] = useState<string>("")
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
  // Prefill desde turno
  const [turnoPrefill, setTurnoPrefill] = useState<null | {
    requiereCrearCliente: boolean
    clienteSnapshot: { nombre: string; telefono: string; email?: string | null } | null
  }>(null)
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
    clearErrors,
    setError,
  } = useForm<OrdenFormData>({
    resolver: zodResolver(ordenSchema),
    defaultValues: {
      clienteId: "",
      dispositivo: "",
      tipoDispositivo: "",
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

  // Prefill desde turno (si la orden nace de una visita agendada)
  useEffect(() => {
    if (!fromTurnoId) return
    let cancelled = false
    fetch(`/api/turnos/${fromTurnoId}/prefill-orden`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}))
          throw new Error(j.error || "No se pudo cargar el turno")
        }
        return r.json()
      })
      .then((d) => {
        if (cancelled) return
        setTurnoPrefill({
          requiereCrearCliente: !!d.requiereCrearCliente,
          clienteSnapshot: d.clienteSnapshot || null,
        })
        if (d.cliente) {
          setSelectedClienteObj(d.cliente)
          setValue("clienteId", d.cliente.id, { shouldValidate: true })
        }
        if (d.orden?.tipoDispositivo) setValue("tipoDispositivo", d.orden.tipoDispositivo)
        if (d.orden?.dispositivo) setValue("dispositivo", d.orden.dispositivo)
        if (d.orden?.marca) setValue("marca", d.orden.marca)
        if (d.orden?.problemaReportado) setValue("problemaReportado", d.orden.problemaReportado)
        if (d.orden?.observaciones) setValue("observaciones", d.orden.observaciones)
        if (d.orden?.telefonoContacto) setValue("telefonoContacto", d.orden.telefonoContacto)
        if (d.orden?.tecnicoId) setSelectedTecnicoId(d.orden.tecnicoId)
        if (d.orden?.fechaPrometida) {
          setValue("fechaPrometida", String(d.orden.fechaPrometida).slice(0, 10))
        }
      })
      .catch((err) => {
        void showError(err.message || "Error al cargar datos del turno")
      })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromTurnoId])

  // Preselección de cliente vía deep-link (?clienteId=) — no aplica si viene de turno
  useEffect(() => {
    if (!initialClienteId || fromTurnoId) return
    let cancelled = false
    setValue("clienteId", initialClienteId, { shouldValidate: true })
    fetch(`/api/clientes/${initialClienteId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((cliente) => {
        if (cancelled || !cliente || cliente.error) return
        setSelectedClienteObj(cliente)
      })
      .catch(() => {})
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialClienteId])

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
  const imeiEsImei = config.campos?.imei?.validacion === "imei"

  // Handle campo extra changes with autoMarca and usarComoDispositivo support
  const handleCampoExtraChange = (campo: CampoExtra, value: any) => {
    setCamposExtraValues((prev) => ({ ...prev, [campo.key]: value }))

    // If this field replaces the device name
    if (campo.usarComoDispositivo && typeof value === "string") {
      setValue("dispositivo", value, { shouldValidate: true })
      if (value.trim()) clearErrors("dispositivo")
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
    setValue("tipoDispositivo", nuevoTipo, { shouldValidate: true })
    if (nuevoTipo) clearErrors("tipoDispositivo")
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
  const clienteSeleccionadoObj = selectedClienteObj?.id === clienteId ? selectedClienteObj : undefined

  const esClienteEmpresa = clienteSeleccionadoObj?.tipoCliente === "EMPRESA" || !!clienteSeleccionadoObj?.razonSocial


  // Fetch técnicos disponibles (solo para ADMIN / no-TECNICO)
  useEffect(() => {
    if (isTecnicoRole) return
    const fetchTecnicos = async () => {
      try {
        const res = await fetch("/api/tecnicos", { cache: "no-store" })
        if (!res.ok) return
        const data = await res.json()
        setTecnicosDisponibles(
          (data || [])
            .filter((t: any) => t.activo !== false)
            .map((t: any) => ({ id: t.id, nombre: t.nombre, activo: t.activo !== false }))
        )
      } catch (error) {
        console.error("Error fetching tecnicos:", error)
      }
    }
    fetchTecnicos()
  }, [isTecnicoRole])

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
        void showError("Por favor selecciona imagenes validas")
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
        void showError("Error al procesar una imagen")
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
        await showError(err.error || "Error al crear sector")
      }
    } catch (e) {
      console.error("Error creating sector:", e)
    } finally {
      setCrearSectorLoading(false)
    }
  }

  const onSubmit = async (data: OrdenFormData) => {
    // Validate IMEI only when the field is configured as IMEI (15 digits)
    if (imeiEsImei && !isValidImei(data.imei)) {
      setError("imei", { message: "El IMEI debe tener exactamente 15 dígitos" })
      return
    }
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
        notasInternas: data.notasInternas || undefined,
        telefonoContacto: data.telefonoContacto || undefined,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        sectorId: selectedSectorId || undefined,
        tecnicoId: !isTecnicoRole && selectedTecnicoId ? selectedTecnicoId : undefined,
        fromTurnoId: fromTurnoId || undefined,
      }

      const res = await offlineFetch("/api/ordenes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ordenPayload),
      }, { store: STORES.ORDERS, description: `Orden - ${data.dispositivo}` })

      if (res.status === 202) {
        // Queued offline
        await showInfo("Orden guardada offline. Se sincronizará automáticamente cuando vuelva la conexión.")
        onSuccess?.()
        onClose()
        return
      }

      if (!res.ok) {
        // Detectar errores de límite de plan y abrir el upgrade modal en vez
        // de un alert genérico. Si no es plan-limit, fallback al alert.
        const handled = await planLimitError.handle(res)
        if (handled.shouldUpgrade) {
          setShowUpgradeModal(true)
          return
        }
        const error = await res.json().catch(() => ({}))
        await showError(error.error || "Error al crear orden")
        return
      }

      const nuevaOrden = await res.json()

      // Guardar checklist si hay template y valores completados
      if (checklistTemplate && Object.keys(checklistValores).length > 0) {
        try {
          const checklistBody = {
            templateId: checklistTemplate.id,
            valores: checklistValores,
            notas: checklistNotas || undefined,
            firmaCliente: checklistFirma || undefined,
            firmaMime: checklistFirmaMime || undefined,
          }
          const checklistRes = await offlineFetch(`/api/ordenes/${nuevaOrden.id}/checklist`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(checklistBody),
          }, { store: STORES.ORDERS, description: `Checklist - ${data.dispositivo}` })
          if (!checklistRes.ok) {
            const checklistErr = await checklistRes.json().catch(() => ({}))
            console.error("[CHECKLIST SAVE] Error:", checklistRes.status, JSON.stringify(checklistErr))
          }
        } catch (checklistError) {
          console.error("[CHECKLIST SAVE] Exception:", checklistError)
        }
      }

      setOrdenCreada({
        id: nuevaOrden.id,
        numeroOrden: nuevaOrden.numeroOrden,
        codigoOrden: nuevaOrden.codigoOrden || undefined,
        dispositivo: data.dispositivo,
        problemaReportado: data.problemaReportado,
        presupuesto: data.presupuesto && data.presupuesto > 0 ? data.presupuesto : null,
        fechaPrometida: data.fechaPrometida || null,
        publicToken: nuevaOrden.publicToken || null,
        cliente: {
          nombre: selectedClienteObj?.nombre || "",
          telefono: selectedClienteObj?.telefono || "",
        },
        telefonoContacto: data.telefonoContacto || null,
        organizationName: nuevaOrden.organizationName || undefined,
        // Campos extra para comprobante térmico
        clienteId: data.clienteId,
        tipoDispositivo: data.tipoDispositivo,
        marca: data.marca || null,
        color: data.color || null,
        imei: data.imei || null,
        accesorios: accesoriosLabels.length > 0 ? accesoriosLabels.join(", ") : null,
        observaciones: data.observaciones || null,
        estado: nuevaOrden.estado || "RECIBIDO",
        costoFinal: nuevaOrden.costoFinal ?? null,
        fechaIngreso: nuevaOrden.fechaIngreso || null,
        organizationLogoUrl: nuevaOrden.organizationLogoUrl ?? null,
        organizationTelefono: nuevaOrden.organizationTelefono ?? null,
        organizationDireccion: nuevaOrden.organizationDireccion ?? null,
        organizationComprobanteTerminos: nuevaOrden.organizationComprobanteTerminos ?? null,
      })
      setShowOrdenCreadaModal(true)
    } catch (error) {
      console.error("Error creating orden:", error)
      await showError("Error al crear orden")
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
        {fromTurnoId && (
          <div className="mb-4 p-3 rounded-lg border border-primary/30 bg-primary/5">
            <p className="text-sm font-medium">Origen: turno agendado</p>
            <p className="text-xs text-muted-foreground">
              Los datos se cargaron desde el turno. Revisalos antes de crear la orden.
            </p>
            {turnoPrefill?.requiereCrearCliente && turnoPrefill.clienteSnapshot && (
              <div className="mt-2 p-2 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900">
                <p className="text-xs text-amber-900 dark:text-amber-200 font-medium">
                  Este turno usa un cliente sin registrar.
                </p>
                <p className="text-xs text-amber-800 dark:text-amber-300 mt-1">
                  Datos: <strong>{turnoPrefill.clienteSnapshot.nombre}</strong> · {turnoPrefill.clienteSnapshot.telefono}
                  {turnoPrefill.clienteSnapshot.email ? ` · ${turnoPrefill.clienteSnapshot.email}` : ""}
                </p>
                <p className="text-xs text-amber-800 dark:text-amber-300 mt-1">
                  Creá primero el cliente con estos datos usando el botón <strong>+</strong> al lado del buscador de cliente.
                </p>
              </div>
            )}
          </div>
        )}
        <form onSubmit={(e) => {
          e.preventDefault()
          if (currentStep < totalSteps) {
            handleNextStep()
          }
        }} className="space-y-4">
          {/* Step indicator */}
          {(() => {
            const stepsForLabel = [
              { step: 1, label: "Cliente y Equipo" },
              { step: 2, label: "Detalles" },
              { step: 3, label: "Fotos y Checklist" },
            ]
            const current = stepsForLabel.find((s) => s.step === currentStep)
            return (
              <p className="text-xs text-center text-muted-foreground sm:hidden mb-2">
                Paso {currentStep}/{totalSteps}{current ? ` · ${current.label}` : ""}
              </p>
            )
          })()}
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
            <ClienteSelector
              value={watch("clienteId") || null}
              onChange={(id, cliente) => {
                setValue("clienteId", id || "", { shouldValidate: !!id })
                setSelectedClienteObj(cliente as Cliente | null)
                if (id) clearErrors("clienteId")
              }}
            />
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

          {/* Marca y Dispositivo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

            <div>
              <Label htmlFor="dispositivo">
                {campoDispositivo ? campoDispositivo.label + " *" : "Modelo / Dispositivo *"}
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
                    {...register("imei", {
                      onChange: imeiEsImei
                        ? (e) => {
                            e.target.value = sanitizeImei(e.target.value)
                          }
                        : undefined,
                    })}
                    placeholder={imeiPlaceholder}
                    maxLength={imeiEsImei ? 15 : imeiMaxLength}
                    inputMode={imeiEsImei ? "numeric" : undefined}
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
                        setValue("problemaReportado", newValue, { shouldValidate: true })
                        if (newValue.trim()) clearErrors("problemaReportado")
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
                type="text"
                inputMode="decimal"
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

          {!isTecnicoRole && tecnicosDisponibles.length > 0 && (
            <div>
              <Label htmlFor="tecnicoId">Técnico asignado (Opcional)</Label>
              <Select
                value={selectedTecnicoId || "NONE"}
                onValueChange={(v) => setSelectedTecnicoId(v === "NONE" ? "" : v)}
              >
                <SelectTrigger id="tecnicoId">
                  <SelectValue placeholder="Sin asignar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Sin asignar</SelectItem>
                  {tecnicosDisponibles.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

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
                      type="text"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      max={watch("presupuesto") || undefined}
                      value={sena || ""}
                      onChange={(e) => setSena(e.target.value ? Number(e.target.value) : undefined)}
                      placeholder="0.00"
                      className="w-28 sm:w-40"
                    />
                  </div>
                  {sena && sena > 0 && (
                    <div className="mt-2">
                      <Label className="text-xs text-muted-foreground">Método de pago de la seña</Label>
                      <div className="flex flex-wrap gap-1.5 mt-1">
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

          {/* Teléfono de contacto alternativo */}
          <div>
            <Label htmlFor="telefonoContacto">Teléfono de contacto</Label>
            <Input
              id="telefonoContacto"
              {...register("telefonoContacto")}
              placeholder={selectedClienteObj?.telefono || "Número alternativo"}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {watch("tipoDispositivo") === "CELULAR"
                ? "El cliente deja su celular — ingresá un número alternativo para contactarlo"
                : "Número alternativo para notificaciones y seguimiento (opcional)"
              }
            </p>
          </div>

          {/* Observaciones */}
          <div>
            <Label htmlFor="observaciones">Observaciones</Label>
            <Textarea
              id="observaciones"
              {...register("observaciones")}
              placeholder="Observaciones adicionales..."
              rows={2}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Visible para el cliente en el comprobante y portal de seguimiento.
            </p>
          </div>

          {/* Notas internas */}
          <div>
            <Label htmlFor="notasInternas">Notas internas</Label>
            <Textarea
              id="notasInternas"
              {...register("notasInternas")}
              placeholder="Solo uso interno (no se muestran al cliente)..."
              rows={2}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Uso interno del equipo. No aparece en comprobantes, PDFs ni portal del cliente.
            </p>
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

          <FormActionBar className="flex-wrap justify-between">
            <div>
              {currentStep > 1 && (
                <Button type="button" variant="outline" onClick={handlePrevStep} className="text-sm">
                  Anterior
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose} className="text-sm">
                Cancelar
              </Button>
              {currentStep < totalSteps ? (
                <Button type="button" onClick={handleNextStep}>
                  Siguiente
                </Button>
              ) : (
                <Button type="button" disabled={loading} onClick={handleSubmit(onSubmit)}>
                  {loading ? "Creando..." : "Crear Orden"}
                </Button>
              )}
            </div>
          </FormActionBar>
        </form>
      </CardContent>

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

      {/* Upgrade modal contextual: se abre cuando el backend retorna
          PLAN_LIMIT_EXCEEDED al crear órdenes (ver usePlanLimitError). */}
      <UpgradeModal
        open={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
      />
    </Card>
  )
}
