"use client"

import { useState, useEffect, useRef } from "react"
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
import type { Cliente } from "@/types"

interface FotoPreview {
  id: string
  preview: string
  file?: File
  descripcion: string
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

// Accesorios comunes por tipo de dispositivo
const ACCESORIOS_POR_TIPO: Record<string, { id: string; label: string }[]> = {
  CELULAR: [
    { id: "cargador", label: "Cargador" },
    { id: "cable", label: "Cable USB" },
    { id: "funda", label: "Funda/Case" },
    { id: "vidrio", label: "Vidrio templado" },
    { id: "auriculares", label: "Auriculares" },
    { id: "sim", label: "Chip SIM" },
    { id: "memoria", label: "Tarjeta memoria" },
  ],
  COMPUTADORA: [
    { id: "cargador_notebook", label: "Cargador/Fuente" },
    { id: "mouse", label: "Mouse" },
    { id: "teclado", label: "Teclado" },
    { id: "bolso", label: "Bolso/Mochila" },
    { id: "disco_externo", label: "Disco externo" },
    { id: "pendrive", label: "Pendrive" },
    { id: "monitor", label: "Monitor" },
    { id: "cables_video", label: "Cables video" },
  ],
  TABLET: [
    { id: "cargador", label: "Cargador" },
    { id: "cable", label: "Cable USB" },
    { id: "funda", label: "Funda/Case" },
    { id: "teclado_bt", label: "Teclado Bluetooth" },
    { id: "stylus", label: "Stylus/Lápiz" },
    { id: "memoria", label: "Tarjeta memoria" },
  ],
  CONSOLA: [
    { id: "fuente", label: "Fuente de poder" },
    { id: "cable_hdmi", label: "Cable HDMI" },
    { id: "control1", label: "Control 1" },
    { id: "control2", label: "Control 2" },
    { id: "control3", label: "Control 3" },
    { id: "control4", label: "Control 4" },
    { id: "auriculares", label: "Auriculares/Headset" },
    { id: "base_carga", label: "Base de carga" },
    { id: "disco_externo", label: "Disco externo" },
    { id: "juegos", label: "Juegos físicos" },
  ],
  SMARTWATCH: [
    { id: "cargador", label: "Cargador" },
    { id: "cable", label: "Cable USB" },
    { id: "malla", label: "Malla/Correa" },
    { id: "caja", label: "Caja original" },
  ],
}

// Accesorios genéricos para tipos de dispositivo personalizados
const ACCESORIOS_GENERICOS = [
  { id: "cable_poder", label: "Cable de poder" },
  { id: "cargador", label: "Cargador/Fuente" },
  { id: "cable_datos", label: "Cable de datos" },
  { id: "control_remoto", label: "Control remoto" },
  { id: "manual", label: "Manual" },
  { id: "caja_original", label: "Caja original" },
]

// Problemas comunes por tipo de dispositivo
const PROBLEMAS_COMUNES: Record<string, string[]> = {
  CELULAR: [
    "No enciende",
    "Pantalla rota",
    "No carga",
    "Batería se agota rápido",
    "Touch no funciona",
    "No reconoce SIM",
    "Cámara no funciona",
    "Altavoz no funciona",
    "Micrófono no funciona",
    "WiFi no conecta",
  ],
  COMPUTADORA: [
    "No enciende",
    "Pantalla azul (BSOD)",
    "Muy lenta / Se congela",
    "No carga batería (notebook)",
    "Teclado no funciona",
    "No detecta WiFi",
    "Disco lleno / Sin espacio",
    "Virus / Malware",
    "No inicia Windows",
    "Pantalla rota (notebook)",
    "Se apaga sola / Sobrecalienta",
    "No reconoce USB",
    "Sin audio",
    "Actualización fallida",
    "Formateo y reinstalación",
  ],
  TABLET: [
    "No enciende",
    "Pantalla rota",
    "No carga",
    "Batería se agota rápido",
    "Touch no responde",
    "Muy lenta",
    "No conecta WiFi",
  ],
  CONSOLA: [
    "No enciende",
    "No lee discos",
    "Se apaga sola / Sobrecalienta",
    "No conecta a internet",
    "Control no sincroniza",
    "Sin imagen HDMI",
    "Error de sistema",
    "Hace ruido extraño",
    "Puerto HDMI dañado",
    "Actualización fallida",
    "Luz parpadeante",
    "Expulsa discos sola",
    "Drift en control (joystick)",
  ],
  SMARTWATCH: [
    "No enciende",
    "No carga",
    "Pantalla rota",
    "No sincroniza",
    "Batería dura poco",
  ],
}

// Problemas genéricos para tipos de dispositivo personalizados
const PROBLEMAS_GENERICOS = [
  "No enciende",
  "No funciona correctamente",
  "Hace ruido extraño",
  "Se apaga solo",
  "Error en pantalla/display",
  "No conecta a red/WiFi",
  "Mantenimiento preventivo",
  "Revisión general",
]

// Marcas comunes por tipo de dispositivo
const MARCAS_POR_TIPO: Record<string, string[]> = {
  CELULAR: ["Apple", "Samsung", "Xiaomi", "Motorola", "Huawei", "LG", "Sony", "OnePlus", "Oppo", "Realme"],
  COMPUTADORA: ["HP", "Dell", "Lenovo", "Asus", "Acer", "Apple", "MSI", "Toshiba", "Samsung", "Armada/Genérica"],
  TABLET: ["Apple", "Samsung", "Huawei", "Lenovo", "Amazon", "Xiaomi"],
  CONSOLA: ["Sony PlayStation", "Microsoft Xbox", "Nintendo"],
  SMARTWATCH: ["Apple", "Samsung", "Huawei", "Xiaomi", "Amazfit", "Garmin", "Fitbit"],
}

// Modelos de consolas comunes
const MODELOS_CONSOLA = [
  "PlayStation 5",
  "PlayStation 5 Digital",
  "PlayStation 4 Pro",
  "PlayStation 4 Slim",
  "PlayStation 4",
  "PlayStation 3",
  "Xbox Series X",
  "Xbox Series S",
  "Xbox One X",
  "Xbox One S",
  "Xbox One",
  "Xbox 360",
  "Nintendo Switch",
  "Nintendo Switch OLED",
  "Nintendo Switch Lite",
  "Nintendo Wii U",
  "Nintendo Wii",
  "Nintendo 3DS",
]

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
  // Campos específicos para PC
  tipoPc: z.enum(["DESKTOP", "NOTEBOOK", "ALL_IN_ONE"]).optional(),
  procesador: z.string().optional(),
  ram: z.string().optional(),
  almacenamiento: z.string().optional(),
  sistemaOperativo: z.string().optional(),
  // Campos específicos para Consola
  modeloConsola: z.string().optional(),
  cantidadControles: z.number().min(0).max(4).optional(),
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
      // Campos PC
      tipoPc: undefined,
      procesador: "",
      ram: "",
      almacenamiento: "",
      sistemaOperativo: "",
      // Campos Consola
      modeloConsola: "",
      cantidadControles: undefined,
    },
  })

  const tipoDispositivo = watch("tipoDispositivo")

  // Obtener accesorios según tipo de dispositivo
  const accesoriosDisponibles = ACCESORIOS_POR_TIPO[tipoDispositivo] || ACCESORIOS_GENERICOS

  // Obtener problemas comunes según tipo
  const problemasComunes = PROBLEMAS_COMUNES[tipoDispositivo] || PROBLEMAS_GENERICOS

  // Obtener marcas según tipo
  const marcasDisponibles = MARCAS_POR_TIPO[tipoDispositivo] || []

  // Determinar si es un tipo base conocido
  const esTipoBase = ["CELULAR", "COMPUTADORA", "TABLET", "CONSOLA", "SMARTWATCH"].includes(tipoDispositivo)

  // Limpiar campos específicos cuando cambia el tipo
  const handleTipoChange = (nuevoTipo: string) => {
    setValue("tipoDispositivo", nuevoTipo)
    // Limpiar accesorios seleccionados al cambiar tipo
    setAccesoriosSeleccionados([])
    // Limpiar campos específicos
    if (nuevoTipo !== "COMPUTADORA") {
      setValue("tipoPc", undefined)
      setValue("procesador", "")
      setValue("ram", "")
      setValue("almacenamiento", "")
      setValue("sistemaOperativo", "")
    }
    if (nuevoTipo !== "CONSOLA") {
      setValue("modeloConsola", "")
      setValue("cantidadControles", undefined)
    }
    // Si es consola, limpiar dispositivo para seleccionar modelo
    if (nuevoTipo === "CONSOLA") {
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

  // Manejar selección de fotos
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    // Copiar archivos ANTES de resetear el input (FileList se invalida al resetear)
    const fileArray = Array.from(files)

    // Reset input después de copiar
    if (fileInputRef.current) fileInputRef.current.value = ""
    if (cameraInputRef.current) cameraInputRef.current.value = ""

    setComprimiendo(true)

    const processFile = async (file: File): Promise<FotoPreview | null> => {
      if (!file.type.startsWith("image/")) {
        alert("Por favor selecciona imágenes válidas")
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

      // Agregar el nuevo cliente a la lista inmediatamente y seleccionarlo
      setClientes(prev => [...prev, nuevoCliente])
      setValue("clienteId", nuevoCliente.id)

      // Cerrar modal y resetear formulario
      setShowClienteModal(false)
      clienteForm.reset()
    } catch (error) {
      console.error("Error creating cliente:", error)
      alert("Error al crear cliente")
    } finally {
      setClienteLoading(false)
    }
  }

  const onSubmit = async (data: OrdenFormData) => {
    setLoading(true)
    try {
      // Construir lista de accesorios
      const accesoriosLabels = accesoriosSeleccionados.map((id) => {
        const acc = accesoriosDisponibles.find((a) => a.id === id)
        return acc ? acc.label : id
      })

      // Preparar fotos para enviar
      const fotosData = fotos.map((foto) => {
        const base64Match = foto.preview.match(/^data:(image\/[a-z]+);base64,(.+)$/)
        return {
          data: base64Match ? base64Match[2] : "",
          mime: base64Match ? base64Match[1] : "image/jpeg",
          descripcion: foto.descripcion || undefined,
          tipo: "INGRESO",
        }
      })

      // Construir información adicional para observaciones (PC/Consola)
      let infoAdicional = ""
      if (data.tipoDispositivo === "COMPUTADORA") {
        const infoPc = []
        if (data.tipoPc) infoPc.push(`Tipo: ${data.tipoPc}`)
        if (data.procesador) infoPc.push(`Procesador: ${data.procesador}`)
        if (data.ram) infoPc.push(`RAM: ${data.ram}`)
        if (data.almacenamiento) infoPc.push(`Almacenamiento: ${data.almacenamiento}`)
        if (data.sistemaOperativo) infoPc.push(`SO: ${data.sistemaOperativo}`)
        if (infoPc.length > 0) {
          infoAdicional = `[INFO PC: ${infoPc.join(" | ")}]`
        }
      } else if (data.tipoDispositivo === "CONSOLA") {
        const infoConsola = []
        if (data.cantidadControles !== undefined) infoConsola.push(`Controles: ${data.cantidadControles}`)
        if (infoConsola.length > 0) {
          infoAdicional = `[INFO CONSOLA: ${infoConsola.join(" | ")}]`
        }
      }

      // Combinar observaciones con info adicional
      const observacionesFinal = [data.observaciones, infoAdicional].filter(Boolean).join("\n")

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
          observaciones: observacionesFinal || undefined,
        }),
      })

      if (!res.ok) {
        const error = await res.json()
        alert(error.error || "Error al crear orden")
        return
      }

      const nuevaOrden = await res.json()

      // Obtener datos del cliente seleccionado
      const clienteSeleccionado = clientes.find(c => c.id === data.clienteId)

      // Preparar datos para el modal
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
                    <span className="text-2xl mb-1">{tipo.icono || "🔧"}</span>
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

          {/* Dispositivo - Para consolas mostrar selector de modelos */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="dispositivo">
                {tipoDispositivo === "CONSOLA" ? "Modelo de Consola *" : "Dispositivo *"}
              </Label>
              {tipoDispositivo === "CONSOLA" ? (
                <Select
                  value={watch("dispositivo") || ""}
                  onValueChange={(value) => {
                    setValue("dispositivo", value)
                    // Auto-completar marca según modelo
                    if (value.includes("PlayStation")) setValue("marca", "Sony PlayStation")
                    else if (value.includes("Xbox")) setValue("marca", "Microsoft Xbox")
                    else if (value.includes("Nintendo") || value.includes("Switch") || value.includes("Wii")) setValue("marca", "Nintendo")
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar modelo..." />
                  </SelectTrigger>
                  <SelectContent>
                    {MODELOS_CONSOLA.map((modelo) => (
                      <SelectItem key={modelo} value={modelo}>
                        {modelo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="dispositivo"
                  {...register("dispositivo")}
                  placeholder={
                    tipoDispositivo === "COMPUTADORA"
                      ? "Ej: HP Pavilion 15, Dell Inspiron 3000"
                      : tipoDispositivo === "CELULAR"
                      ? "Ej: iPhone 12 Pro Max, Samsung S21"
                      : tipoDispositivo === "TABLET"
                      ? "Ej: iPad Pro 12.9, Galaxy Tab S7"
                      : !esTipoBase
                      ? "Modelo o descripción del equipo"
                      : "Ej: iPad Pro 12.9, Galaxy Tab S7"
                  }
                />
              )}
              {errors.dispositivo && (
                <p className="text-sm text-destructive mt-1">
                  {errors.dispositivo.message}
                </p>
              )}
            </div>

            {/* Marca con selección rápida */}
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
          </div>

          {/* Campos específicos para COMPUTADORA */}
          {tipoDispositivo === "COMPUTADORA" && (
            <div className="border rounded-lg p-4 bg-blue-50/30 dark:bg-blue-950/20 space-y-4">
              <h4 className="font-medium text-sm flex items-center gap-2">
                💻 Información del Equipo
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <Label className="text-xs">Tipo de PC</Label>
                  <Select
                    value={watch("tipoPc") || ""}
                    onValueChange={(value) => setValue("tipoPc", value ? value as "DESKTOP" | "NOTEBOOK" | "ALL_IN_ONE" : undefined)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NOTEBOOK">Notebook</SelectItem>
                      <SelectItem value="DESKTOP">Desktop</SelectItem>
                      <SelectItem value="ALL_IN_ONE">All-in-One</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Procesador</Label>
                  <Input
                    {...register("procesador")}
                    placeholder="i5, Ryzen 5..."
                    className="h-9"
                  />
                </div>
                <div>
                  <Label className="text-xs">RAM</Label>
                  <Select
                    value={watch("ram") || ""}
                    onValueChange={(value) => setValue("ram", value || undefined)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="2GB">2 GB</SelectItem>
                      <SelectItem value="4GB">4 GB</SelectItem>
                      <SelectItem value="8GB">8 GB</SelectItem>
                      <SelectItem value="16GB">16 GB</SelectItem>
                      <SelectItem value="32GB">32 GB</SelectItem>
                      <SelectItem value="No sabe">No sabe</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Almacenamiento</Label>
                  <Select
                    value={watch("almacenamiento") || ""}
                    onValueChange={(value) => setValue("almacenamiento", value || undefined)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="HDD 500GB">HDD 500GB</SelectItem>
                      <SelectItem value="HDD 1TB">HDD 1TB</SelectItem>
                      <SelectItem value="SSD 128GB">SSD 128GB</SelectItem>
                      <SelectItem value="SSD 256GB">SSD 256GB</SelectItem>
                      <SelectItem value="SSD 512GB">SSD 512GB</SelectItem>
                      <SelectItem value="SSD 1TB">SSD 1TB</SelectItem>
                      <SelectItem value="No sabe">No sabe</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs">Sistema Operativo</Label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {["Windows 11", "Windows 10", "Windows 7", "Linux", "macOS", "No inicia"].map((so) => (
                    <button
                      key={so}
                      type="button"
                      onClick={() => setValue("sistemaOperativo", so)}
                      className={`px-2 py-1 text-xs rounded border transition-colors ${
                        watch("sistemaOperativo") === so
                          ? "bg-primary text-primary-foreground border-primary"
                          : "hover:bg-muted"
                      }`}
                    >
                      {so}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Campos específicos para CONSOLA */}
          {tipoDispositivo === "CONSOLA" && (
            <div className="border rounded-lg p-4 bg-purple-50/30 dark:bg-purple-950/20 space-y-4">
              <h4 className="font-medium text-sm flex items-center gap-2">
                🎮 Información de la Consola
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Cantidad de Controles</Label>
                  <div className="flex gap-1 mt-1">
                    {[0, 1, 2, 3, 4].map((num) => (
                      <button
                        key={num}
                        type="button"
                        onClick={() => setValue("cantidadControles", num)}
                        className={`w-10 h-10 rounded border font-medium transition-colors ${
                          watch("cantidadControles") === num
                            ? "bg-primary text-primary-foreground border-primary"
                            : "hover:bg-muted"
                        }`}
                      >
                        {num}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Número de Serie</Label>
                  <Input
                    {...register("imei")}
                    placeholder="S/N de la consola"
                    className="h-9"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Color e IMEI/Serial */}
          {tipoDispositivo !== "CONSOLA" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="color">Color</Label>
                <Input
                  id="color"
                  {...register("color")}
                  placeholder="Ej: Negro, Azul"
                />
              </div>
              {tipoDispositivo !== "COMPUTADORA" && (
                <div>
                  <Label htmlFor="imei">{esTipoBase ? "IMEI/Serial" : "Número de Serie"}</Label>
                  <Input
                    id="imei"
                    {...register("imei")}
                    placeholder={esTipoBase ? "123456789012345" : "S/N del equipo"}
                    maxLength={esTipoBase ? 15 : undefined}
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

          {/* Problema reportado con selección rápida */}
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
                    El cliente acepta el precio y deja el equipo para reparación
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
                  <p className="text-xs text-muted-foreground mt-1">
                    Monto que el cliente deja como anticipo
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Accesorios recibidos - dinámicos según tipo */}
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

          {/* Password del dispositivo */}
          <div>
            <Label>Contraseña/Patrón del Dispositivo</Label>
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
                PIN / Contraseña
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
                Patrón
              </Button>
            </div>
            {passwordType === "text" ? (
              <Input
                id="codigoAccesoDispositivo"
                {...register("codigoAccesoDispositivo")}
                placeholder="PIN o contraseña para pruebas"
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
          </div>

          {/* Fotos de ingreso */}
          <div>
            <Label>Fotos del Equipo (Ingreso)</Label>
            <div className="mt-2 space-y-3">
              {/* Botones para agregar fotos */}
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

              {/* Indicador de compresión */}
              {comprimiendo && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Comprimiendo imágenes...
                </div>
              )}

              {/* Preview de fotos */}
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
                        placeholder="Descripción..."
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

