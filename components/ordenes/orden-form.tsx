"use client"

import { useState, useEffect, useRef } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
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

// Lista de accesorios comunes
const ACCESORIOS_COMUNES = [
  { id: "cargador", label: "Cargador" },
  { id: "cable", label: "Cable USB" },
  { id: "funda", label: "Funda/Case" },
  { id: "vidrio", label: "Vidrio templado" },
  { id: "auriculares", label: "Auriculares" },
  { id: "sim", label: "Chip SIM" },
  { id: "memoria", label: "Tarjeta memoria" },
  { id: "stylus", label: "Stylus/Lápiz" },
]

const ordenSchema = z.object({
  clienteId: z.string().min(1, "El cliente es requerido"),
  dispositivo: z.string().min(1, "El dispositivo es requerido"),
  tipoDispositivo: z.enum(["CELULAR", "COMPUTADORA", "TABLET", "CONSOLA", "SMARTWATCH"]),
  marca: z.string().optional(),
  color: z.string().optional(),
  imei: z.string()
    .regex(/^(\d{15})?$/, "El IMEI debe tener exactamente 15 dígitos")
    .optional()
    .or(z.literal("")),
  problemaReportado: z.string().min(1, "El problema es requerido"),
  accesorios: z.string().optional(),
  passwordDispositivo: z.string().optional(),
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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

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
      passwordDispositivo: "",
      fechaPrometida: "",
    },
  })

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
      const res = await fetch("/api/clientes")
      const data = await res.json()
      setClientes(data)
      return data
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
    if (!files) return

    // Reset input inmediatamente
    if (fileInputRef.current) fileInputRef.current.value = ""
    if (cameraInputRef.current) cameraInputRef.current.value = ""

    setComprimiendo(true)

    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) {
        alert("Por favor selecciona imágenes válidas")
        continue
      }

      try {
        // Comprimir imagen (máx 300KB, 1920px)
        const compressedFile = await compressImage(file)

        const reader = new FileReader()
        reader.onloadend = () => {
          setFotos((prev) => [
            ...prev,
            {
              id: Math.random().toString(36).substr(2, 9),
              preview: reader.result as string,
              file: compressedFile,
              descripcion: "",
            },
          ])
        }
        reader.readAsDataURL(compressedFile)
      } catch (error) {
        console.error("Error procesando imagen:", error)
        alert("Error al procesar una imagen")
      }
    }

    setComprimiendo(false)
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

      // Actualizar lista de clientes y seleccionar el nuevo
      const clientesActualizados = await fetchClientes()
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
        const acc = ACCESORIOS_COMUNES.find((a) => a.id === id)
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
                id="clienteId"
                {...register("clienteId")}
                onChange={(e) => setValue("clienteId", e.target.value)}
                className="flex-1"
              >
                <option value="">Seleccionar cliente...</option>
                {clientes.map((cliente) => (
                  <option key={cliente.id} value={cliente.id}>
                    {cliente.nombre} - {cliente.telefono}
                  </option>
                ))}
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="dispositivo">Dispositivo *</Label>
              <Input
                id="dispositivo"
                {...register("dispositivo")}
                placeholder="Ej: iPhone 12 Pro Max"
              />
              {errors.dispositivo && (
                <p className="text-sm text-destructive mt-1">
                  {errors.dispositivo.message}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="tipoDispositivo">Tipo *</Label>
              <Select
                id="tipoDispositivo"
                {...register("tipoDispositivo")}
                onChange={(e) =>
                  setValue("tipoDispositivo", e.target.value as OrdenFormData["tipoDispositivo"])
                }
              >
                <option value="CELULAR">Celular</option>
                <option value="COMPUTADORA">Computadora</option>
                <option value="TABLET">Tablet</option>
                <option value="CONSOLA">Consola</option>
                <option value="SMARTWATCH">Smartwatch</option>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="marca">Marca</Label>
              <Input
                id="marca"
                {...register("marca")}
                placeholder="Ej: Apple, Samsung"
              />
            </div>
            <div>
              <Label htmlFor="color">Color</Label>
              <Input
                id="color"
                {...register("color")}
                placeholder="Ej: Negro, Azul"
              />
            </div>
            <div>
              <Label htmlFor="imei">IMEI/Serial</Label>
              <Input
                id="imei"
                {...register("imei")}
                placeholder="123456789012345"
                maxLength={15}
              />
              {errors.imei && (
                <p className="text-sm text-destructive mt-1">
                  {errors.imei.message}
                </p>
              )}
            </div>
          </div>

          <div>
            <Label htmlFor="problemaReportado">Problema Reportado *</Label>
            <Textarea
              id="problemaReportado"
              {...register("problemaReportado")}
              placeholder="Describa el problema..."
              rows={4}
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

          {/* Accesorios recibidos */}
          <div>
            <Label>Accesorios Recibidos</Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
              {ACCESORIOS_COMUNES.map((acc) => (
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
            {accesoriosSeleccionados.filter((a) => !ACCESORIOS_COMUNES.find((c) => c.id === a)).length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {accesoriosSeleccionados
                  .filter((a) => !ACCESORIOS_COMUNES.find((c) => c.id === a))
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
                  setValue("passwordDispositivo", "")
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
                  setValue("passwordDispositivo", "")
                }}
                className="flex-1"
              >
                <Grid3X3 className="h-4 w-4 mr-2" />
                Patrón
              </Button>
            </div>
            {passwordType === "text" ? (
              <Input
                id="passwordDispositivo"
                {...register("passwordDispositivo")}
                placeholder="PIN o contraseña para pruebas"
              />
            ) : (
              <PatternLock
                value={watch("passwordDispositivo")}
                onChange={(pattern) => setValue("passwordDispositivo", pattern)}
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

