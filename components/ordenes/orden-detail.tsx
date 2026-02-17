"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { OrderStatusBadge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ArrowLeft,
  User,
  Phone,
  Mail,
  MapPin,
  Calendar,
  Wrench,
  Plus,
  Trash2,
  FileText,
  FileDown,
  Smartphone,
  DollarSign,
  Clock,
  Camera,
  ClipboardCheck,
  Package,
  History,
  MessageSquare,
  Receipt,
  Shield,
} from "lucide-react"
import Link from "next/link"
import { useCurrency } from "@/contexts/currency-context"
import { CotizacionList } from "@/components/cotizaciones/cotizacion-list"
import { GarantiaCard } from "@/components/garantias/garantia-card"
import { FotoGallery } from "@/components/fotos/foto-gallery"
import { ChecklistCard } from "@/components/checklist/checklist-card"
import { WhatsAppDialog } from "@/components/ordenes/whatsapp-dialog"
import { EntregaDialog } from "@/components/ordenes/entrega-dialog"
import { NotificationHistory } from "@/components/ordenes/notification-history"
import { PatternDisplay } from "@/components/ui/pattern-display"
import { useModal } from "@/contexts/modal-context"
import type { OrdenServicio, EstadoOrden, User as UserType } from "@/types"

const estadoLabels: Record<EstadoOrden, string> = {
  RECIBIDO: "Recibido",
  EN_DIAGNOSTICO: "En Diagnóstico",
  PRESUPUESTADO: "Presupuestado",
  APROBADO: "Aprobado",
  EN_REPARACION: "En Reparación",
  ESPERANDO_REPUESTO: "Esperando Repuesto",
  REPARADO: "Reparado",
  ENTREGADO: "Entregado",
  CANCELADO: "Cancelado",
  SIN_REPARACION: "Sin Reparación",
}

// Orden de los estados en el flujo normal
const estadoFlow: EstadoOrden[] = [
  "RECIBIDO",
  "EN_DIAGNOSTICO",
  "PRESUPUESTADO",
  "APROBADO",
  "EN_REPARACION",
  "REPARADO",
  "ENTREGADO",
]

interface OrdenDetailProps {
  ordenId: string
}

export function OrdenDetail({ ordenId }: OrdenDetailProps) {
  const router = useRouter()
  const { data: session } = useSession()
  const { confirm, alert } = useModal()
  const { formatPrice, formatDate } = useCurrency()
  const [orden, setOrden] = useState<any>(null)
  const [tecnicos, setTecnicos] = useState<UserType[]>([])
  const [inventario, setInventario] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const [activeTab, setActiveTab] = useState("repuestos")
  const [showEntregaDialog, setShowEntregaDialog] = useState(false)

  // Repuesto form state
  const [showAddRepuesto, setShowAddRepuesto] = useState(false)
  const [tipoRepuesto, setTipoRepuesto] = useState<"inventario" | "manual">("inventario")
  const [nuevoRepuesto, setNuevoRepuesto] = useState({
    inventarioId: "",
    cantidad: 1,
    nombre: "",
    precioUnitario: 0,
  })

  const isAdmin = session?.user?.role === "ADMIN"

  useEffect(() => {
    fetchOrden()
    fetchTecnicos()
    fetchInventario()
  }, [ordenId])

  const fetchOrden = async () => {
    try {
      const res = await fetch(`/api/ordenes/${ordenId}`)
      if (!res.ok) {
        router.push("/ordenes")
        return
      }
      const data = await res.json()
      setOrden(data)
    } catch (error) {
      console.error("Error fetching orden:", error)
    } finally {
      setLoading(false)
    }
  }

  const fetchTecnicos = async () => {
    try {
      const res = await fetch("/api/tecnicos")
      const data = await res.json()
      setTecnicos(data)
    } catch (error) {
      console.error("Error fetching tecnicos:", error)
    }
  }

  const fetchInventario = async () => {
    try {
      const res = await fetch("/api/inventario")
      const data = await res.json()
      setInventario(data)
    } catch (error) {
      console.error("Error fetching inventario:", error)
    }
  }

  const handleUpdateEstado = async (nuevoEstado: EstadoOrden) => {
    // Interceptar cambio a ENTREGADO para abrir diálogo de firma
    if (nuevoEstado === "ENTREGADO") {
      setShowEntregaDialog(true)
      return
    }

    setUpdating(true)
    try {
      const res = await fetch(`/api/ordenes/${ordenId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: nuevoEstado }),
      })
      if (res.ok) fetchOrden()
    } catch (error) {
      console.error("Error updating estado:", error)
    } finally {
      setUpdating(false)
    }
  }

  const handleEntregaSuccess = () => {
    setShowEntregaDialog(false)
    fetchOrden()
  }

  const handleAsignarTecnico = async (tecnicoId: string | null) => {
    setUpdating(true)
    try {
      const res = await fetch(`/api/ordenes/${ordenId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tecnicoId }),
      })
      if (res.ok) fetchOrden()
    } catch (error) {
      console.error("Error assigning tecnico:", error)
    } finally {
      setUpdating(false)
    }
  }

  const handleUpdateField = async (field: string, value: any) => {
    setUpdating(true)
    try {
      const res = await fetch(`/api/ordenes/${ordenId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      })
      if (res.ok) fetchOrden()
    } catch (error) {
      console.error(`Error updating ${field}:`, error)
    } finally {
      setUpdating(false)
    }
  }

  const handleAddRepuesto = async () => {
    // Validar según el tipo
    if (tipoRepuesto === "inventario") {
      if (!nuevoRepuesto.inventarioId || nuevoRepuesto.cantidad < 1) {
        await alert({
          title: "Datos incompletos",
          description: "Selecciona un item y cantidad",
          variant: "warning",
        })
        return
      }
    } else {
      if (!nuevoRepuesto.nombre.trim() || nuevoRepuesto.cantidad < 1 || nuevoRepuesto.precioUnitario < 0) {
        await alert({
          title: "Datos incompletos",
          description: "Completa nombre, cantidad y precio",
          variant: "warning",
        })
        return
      }
    }

    setUpdating(true)
    try {
      const payload = tipoRepuesto === "inventario"
        ? {
            tipo: "inventario",
            inventarioId: nuevoRepuesto.inventarioId,
            cantidad: nuevoRepuesto.cantidad,
          }
        : {
            tipo: "manual",
            nombre: nuevoRepuesto.nombre.trim(),
            cantidad: nuevoRepuesto.cantidad,
            precioUnitario: nuevoRepuesto.precioUnitario,
          }

      const res = await fetch(`/api/ordenes/${ordenId}/repuestos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        setNuevoRepuesto({ inventarioId: "", cantidad: 1, nombre: "", precioUnitario: 0 })
        setShowAddRepuesto(false)
        fetchOrden()
      } else {
        const error = await res.json()
        await alert({
          title: "Error",
          description: error.error || "Error al agregar repuesto",
          variant: "error",
        })
      }
    } catch (error) {
      console.error("Error adding repuesto:", error)
    } finally {
      setUpdating(false)
    }
  }

  const handleRemoveRepuesto = async (repuestoId: string) => {
    const confirmed = await confirm({
      title: "Eliminar repuesto",
      description: "¿Estás seguro de eliminar este repuesto de la orden?",
      confirmText: "Eliminar",
      variant: "danger",
    })
    if (!confirmed) return

    setUpdating(true)
    try {
      const res = await fetch(
        `/api/ordenes/${ordenId}/repuestos?repuestoId=${repuestoId}`,
        { method: "DELETE" }
      )
      if (res.ok) fetchOrden()
    } catch (error) {
      console.error("Error removing repuesto:", error)
    } finally {
      setUpdating(false)
    }
  }

  const handleGenerarFactura = async () => {
    const confirmed = await confirm({
      title: "Generar factura",
      description: "¿Generar factura para esta orden?",
      confirmText: "Generar",
      variant: "info",
    })
    if (!confirmed) return

    setUpdating(true)
    try {
      const res = await fetch("/api/facturacion/generar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ordenId }),
      })

      if (res.ok) {
        await alert({
          title: "Factura generada",
          description: "La factura se generó correctamente",
          variant: "success",
        })
        router.push("/facturacion")
      } else {
        const error = await res.json()
        await alert({
          title: "Error",
          description: error.error || "Error al generar factura",
          variant: "error",
        })
      }
    } catch (error) {
      await alert({
        title: "Error",
        description: "Error al generar factura",
        variant: "error",
      })
    } finally {
      setUpdating(false)
    }
  }

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true)
    try {
      const res = await fetch(`/api/ordenes/${ordenId}/pdf`)
      if (!res.ok) throw new Error("Error al generar PDF")
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `orden-${orden.codigoOrden || orden.numeroOrden}.pdf`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (error) {
      await alert({
        title: "Error",
        description: "No se pudo descargar el PDF",
        variant: "error",
      })
    } finally {
      setDownloadingPdf(false)
    }
  }

  const handleDeleteOrden = async () => {
    const codigoDisplay = orden.codigoOrden || `#${orden.numeroOrden}`
    const confirmed = await confirm({
      title: "Eliminar orden",
      description: `¿Estás seguro de eliminar la Orden ${codigoDisplay}? Esta acción no se puede deshacer.`,
      confirmText: "Eliminar",
      variant: "danger",
    })
    if (!confirmed) return

    setDeleting(true)
    try {
      const res = await fetch(`/api/ordenes/${ordenId}`, { method: "DELETE" })
      if (res.ok) {
        router.push("/ordenes")
      } else {
        const error = await res.json()
        await alert({
          title: "Error",
          description: error.error || "Error al eliminar orden",
          variant: "error",
        })
      }
    } catch (error) {
      await alert({
        title: "Error",
        description: "Error al eliminar orden",
        variant: "error",
      })
    } finally {
      setDeleting(false)
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10 rounded-md" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-6 w-24" />
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-[400px] lg:col-span-2" />
          <Skeleton className="h-[400px]" />
        </div>
      </div>
    )
  }

  if (!orden) {
    return <div className="text-center py-8 text-muted-foreground">Orden no encontrada</div>
  }

  const subtotalRepuestos =
    orden.repuestos?.reduce(
      (sum: number, r: any) => sum + r.cantidad * r.precioUnitario,
      0
    ) || 0

  const currentEstadoIndex = estadoFlow.indexOf(orden.estado)
  const progressPercentage = orden.estado === "CANCELADO" || orden.estado === "SIN_REPARACION"
    ? 0
    : Math.round(((currentEstadoIndex + 1) / estadoFlow.length) * 100)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Link href="/ordenes">
            <Button variant="outline" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">
                Orden {orden.codigoOrden || `#${orden.numeroOrden}`}
              </h1>
              <OrderStatusBadge status={orden.estado} showIcon />
            </div>
            <p className="text-sm text-muted-foreground">
              Ingresado el {formatDate(orden.fechaIngreso)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <WhatsAppDialog
            context={{
              organizationId: "",
              organizationName: "",
              orden: {
                id: orden.id,
                numeroOrden: orden.numeroOrden,
                estado: orden.estado,
                dispositivo: orden.dispositivo,
                presupuesto: orden.presupuesto,
                fechaCompletado: orden.fechaCompletado ? new Date(orden.fechaCompletado) : null,
              },
              cliente: {
                id: orden.cliente.id,
                nombre: orden.cliente.nombre,
                email: orden.cliente.email,
                telefono: orden.cliente.telefono,
              },
            }}
          />
          <Button variant="outline" size="sm" onClick={handleDownloadPdf} disabled={downloadingPdf}>
            <FileDown className="h-4 w-4 mr-2" />
            {downloadingPdf ? "..." : "PDF"}
          </Button>
          {isAdmin && (
            <Button variant="destructive" size="sm" onClick={handleDeleteOrden} disabled={deleting}>
              <Trash2 className="h-4 w-4 mr-2" />
              {deleting ? "..." : "Eliminar"}
            </Button>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      {orden.estado !== "CANCELADO" && orden.estado !== "SIN_REPARACION" && (
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Progreso</span>
            <span>{progressPercentage}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-500"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
        </div>
      )}

      {/* Main Content - 2 columns */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column - Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Main Info Card */}
          <Card>
            <CardContent className="p-6">
              <div className="grid gap-6 md:grid-cols-2">
                {/* Cliente */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <User className="h-4 w-4" />
                    CLIENTE
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-lg font-semibold">{orden.cliente.nombre}</h3>
                    <div className="flex items-center gap-2 text-sm">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <a href={`tel:${orden.cliente.telefono}`} className="hover:text-primary">
                        {orden.cliente.telefono}
                      </a>
                    </div>
                    {orden.cliente.email && (
                      <div className="flex items-center gap-2 text-sm">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground">{orden.cliente.email}</span>
                      </div>
                    )}
                    {orden.cliente.direccion && (
                      <div className="flex items-center gap-2 text-sm">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground">{orden.cliente.direccion}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Dispositivo */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <Smartphone className="h-4 w-4" />
                    DISPOSITIVO
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-lg font-semibold">{orden.dispositivo}</h3>
                    <div className="flex flex-wrap gap-2 text-sm">
                      <span className="px-2 py-0.5 bg-muted rounded">{orden.tipoDispositivo}</span>
                      {orden.marca && <span className="px-2 py-0.5 bg-muted rounded">{orden.marca}</span>}
                      {orden.color && <span className="px-2 py-0.5 bg-muted rounded">{orden.color}</span>}
                    </div>
                    {orden.imei && (
                      <div className="text-sm">
                        <span className="text-muted-foreground">IMEI/Serial: </span>
                        <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{orden.imei}</code>
                      </div>
                    )}
                    {orden.codigoAccesoDispositivo && (
                      <div className="text-sm">
                        <span className="text-muted-foreground">Contraseña: </span>
                        {orden.codigoAccesoDispositivo.startsWith("Patrón:") ? (
                          <PatternDisplay value={orden.codigoAccesoDispositivo} size={80} />
                        ) : (
                          <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{orden.codigoAccesoDispositivo}</code>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Problema */}
              <div className="mt-6 pt-6 border-t">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-2">
                  <Wrench className="h-4 w-4" />
                  PROBLEMA REPORTADO
                </div>
                <p className="text-sm">{orden.problemaReportado}</p>
              </div>

              {/* Accesorios */}
              {orden.accesorios && (
                <div className="mt-4 pt-4 border-t">
                  <div className="text-sm font-medium text-muted-foreground mb-1">Accesorios recibidos</div>
                  <p className="text-sm text-muted-foreground">{orden.accesorios}</p>
                </div>
              )}

              {/* Observaciones */}
              {orden.observaciones && (
                <div className="mt-4 pt-4 border-t">
                  <div className="text-sm font-medium text-muted-foreground mb-1">Observaciones</div>
                  <p className="text-sm whitespace-pre-wrap">{orden.observaciones}</p>
                </div>
              )}

              {/* Firma de recepcion */}
              {orden.firmaClienteRecepcion && (
                <div className="mt-4 pt-4 border-t">
                  <div className="text-sm font-medium text-muted-foreground mb-2">Firma del cliente (recepcion)</div>
                  <img
                    src={`data:${orden.firmaClienteRecepcionMime || "image/png"};base64,${orden.firmaClienteRecepcion}`}
                    alt="Firma del cliente"
                    className="max-w-[200px] border rounded bg-white p-2"
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Tabs for additional sections */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full justify-start overflow-x-auto flex-nowrap">
              <TabsTrigger value="repuestos" className="gap-2">
                <Package className="h-4 w-4" />
                Repuestos
              </TabsTrigger>
              <TabsTrigger value="fotos" className="gap-2">
                <Camera className="h-4 w-4" />
                Fotos
              </TabsTrigger>
              <TabsTrigger value="checklist" className="gap-2">
                <ClipboardCheck className="h-4 w-4" />
                Checklist
              </TabsTrigger>
              <TabsTrigger value="cotizaciones" className="gap-2">
                <FileText className="h-4 w-4" />
                Cotizaciones
              </TabsTrigger>
              <TabsTrigger value="historial" className="gap-2">
                <History className="h-4 w-4" />
                Historial
              </TabsTrigger>
            </TabsList>

            <TabsContent value="repuestos" className="mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Repuestos Utilizados</CardTitle>
                    {!showAddRepuesto && (
                      <Button size="sm" variant="outline" onClick={() => setShowAddRepuesto(true)}>
                        <Plus className="h-4 w-4 mr-1" />
                        Agregar
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {showAddRepuesto && (
                    <div className="mb-4 p-3 border rounded-lg space-y-3 bg-muted/30">
                      {/* Toggle tipo de repuesto */}
                      <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
                        <button
                          type="button"
                          onClick={() => setTipoRepuesto("inventario")}
                          className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                            tipoRepuesto === "inventario"
                              ? "bg-background shadow-sm font-medium"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          Del inventario
                        </button>
                        <button
                          type="button"
                          onClick={() => setTipoRepuesto("manual")}
                          className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                            tipoRepuesto === "manual"
                              ? "bg-background shadow-sm font-medium"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          Manual
                        </button>
                      </div>

                      {tipoRepuesto === "inventario" ? (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <Label className="text-xs">Item</Label>
                            <Select
                              value={nuevoRepuesto.inventarioId || "none"}
                              onValueChange={(value) => setNuevoRepuesto({ ...nuevoRepuesto, inventarioId: value === "none" ? "" : value })}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Seleccionar..." />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">Seleccionar...</SelectItem>
                                {inventario.map((item) => (
                                  <SelectItem key={item.id} value={item.id}>
                                    {item.nombre} (Stock: {item.stock})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs">Cantidad</Label>
                            <Input
                              type="number"
                              min="1"
                              value={nuevoRepuesto.cantidad}
                              onChange={(e) => setNuevoRepuesto({ ...nuevoRepuesto, cantidad: parseInt(e.target.value) || 1 })}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="sm:col-span-3">
                            <Label className="text-xs">Nombre del repuesto</Label>
                            <Input
                              placeholder="Ej: Flex de carga iPhone 12"
                              value={nuevoRepuesto.nombre}
                              onChange={(e) => setNuevoRepuesto({ ...nuevoRepuesto, nombre: e.target.value })}
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Cantidad</Label>
                            <Input
                              type="number"
                              min="1"
                              value={nuevoRepuesto.cantidad}
                              onChange={(e) => setNuevoRepuesto({ ...nuevoRepuesto, cantidad: parseInt(e.target.value) || 1 })}
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <Label className="text-xs">Precio unitario</Label>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="0.00"
                              value={nuevoRepuesto.precioUnitario || ""}
                              onChange={(e) => setNuevoRepuesto({ ...nuevoRepuesto, precioUnitario: parseFloat(e.target.value) || 0 })}
                            />
                          </div>
                        </div>
                      )}

                      <div className="flex gap-2">
                        <Button size="sm" onClick={handleAddRepuesto} disabled={updating}>
                          Agregar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setShowAddRepuesto(false)
                            setTipoRepuesto("inventario")
                            setNuevoRepuesto({ inventarioId: "", cantidad: 1, nombre: "", precioUnitario: 0 })
                          }}
                        >
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  )}

                  {orden.repuestos && orden.repuestos.length > 0 ? (
                    <div className="space-y-2">
                      {orden.repuestos.map((repuesto: any) => (
                        <div
                          key={repuesto.id}
                          className="flex items-center justify-between p-3 border rounded-lg"
                        >
                          <div>
                            <div className="font-medium flex items-center gap-2">
                              {repuesto.inventario?.nombre || repuesto.nombre}
                              {!repuesto.inventario && (
                                <span className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                                  Manual
                                </span>
                              )}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {repuesto.cantidad} × {formatPrice(repuesto.precioUnitario)}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-semibold">
                              {formatPrice(repuesto.cantidad * repuesto.precioUnitario)}
                            </span>
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleRemoveRepuesto(repuesto.id)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </div>
                      ))}
                      <div className="flex justify-between pt-3 border-t font-semibold">
                        <span>Subtotal Repuestos</span>
                        <span>{formatPrice(subtotalRepuestos)}</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No hay repuestos agregados
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="fotos" className="mt-4">
              <FotoGallery ordenId={ordenId} />
            </TabsContent>

            <TabsContent value="checklist" className="mt-4">
              <ChecklistCard ordenId={ordenId} />
            </TabsContent>

            <TabsContent value="cotizaciones" className="mt-4">
              <Card>
                <CardContent className="p-6">
                  <CotizacionList ordenId={ordenId} clienteEmail={orden.cliente?.email} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="historial" className="mt-4">
              <NotificationHistory ordenId={ordenId} />
            </TabsContent>
          </Tabs>

          {/* Garantía */}
          <GarantiaCard ordenId={ordenId} ordenEstado={orden.estado} />
        </div>

        {/* Right Column - Management */}
        <div className="space-y-6">
          {/* Estado */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Estado
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select
                value={orden.estado}
                onValueChange={(value) => handleUpdateEstado(value as EstadoOrden)}
                disabled={updating}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(estadoLabels).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Ingreso</span>
                  <span>{formatDate(orden.fechaIngreso)}</span>
                </div>
                {orden.fechaPrometida && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Prometida</span>
                    <span>{formatDate(orden.fechaPrometida)}</span>
                  </div>
                )}
                {orden.fechaCompletado && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Completado</span>
                    <span>{formatDate(orden.fechaCompletado)}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Técnico */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Wrench className="h-4 w-4" />
                Técnico Asignado
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Select
                value={orden.tecnicoId || "none"}
                onValueChange={(value) => handleAsignarTecnico(value === "none" ? null : value)}
                disabled={updating}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sin asignar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin asignar</SelectItem>
                  {tecnicos.map((tecnico) => (
                    <SelectItem key={tecnico.id} value={tecnico.id}>
                      {tecnico.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Costos */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Presupuesto y Costos
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-xs text-muted-foreground">Presupuesto</Label>
                <div className="flex gap-2 mt-1">
                  <Input
                    type="number"
                    step="0.01"
                    defaultValue={orden.presupuesto || ""}
                    placeholder="0.00"
                    onBlur={(e) => {
                      const value = parseFloat(e.target.value) || null
                      if (value !== orden.presupuesto) handleUpdateField("presupuesto", value)
                    }}
                  />
                </div>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">Costo Final</Label>
                <div className="flex gap-2 mt-1">
                  <Input
                    type="number"
                    step="0.01"
                    defaultValue={orden.costoFinal || ""}
                    placeholder="0.00"
                    onBlur={(e) => {
                      const value = parseFloat(e.target.value) || null
                      if (value !== orden.costoFinal) handleUpdateField("costoFinal", value)
                    }}
                  />
                </div>
              </div>

              {/* Resumen */}
              {(orden.sena > 0 || orden.costoFinal) && (
                <div className="pt-3 border-t space-y-2">
                  {orden.sena > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Seña/Adelanto</span>
                      <span className="text-success">-{formatPrice(orden.sena)}</span>
                    </div>
                  )}
                  {orden.costoFinal && (
                    <div className="flex justify-between font-semibold">
                      <span>Saldo Pendiente</span>
                      <span className="text-lg">
                        {formatPrice(Math.max(0, (orden.costoFinal || 0) - (orden.sena || 0)))}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Facturación */}
          {(orden.estado === "REPARADO" || orden.estado === "ENTREGADO") && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Receipt className="h-4 w-4" />
                  Facturación
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Button onClick={handleGenerarFactura} disabled={updating} className="w-full">
                  <FileText className="h-4 w-4 mr-2" />
                  Generar Factura
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Diálogo de Entrega con Firma */}
      {orden && (
        <EntregaDialog
          open={showEntregaDialog}
          onClose={() => setShowEntregaDialog(false)}
          onSuccess={handleEntregaSuccess}
          orden={{
            id: orden.id,
            numeroOrden: orden.numeroOrden,
            codigoOrden: orden.codigoOrden,
            dispositivo: orden.dispositivo,
            cliente: {
              nombre: orden.cliente?.nombre || "Sin nombre",
              telefono: orden.cliente?.telefono || "",
            },
          }}
          encargadoNombre={session?.user?.name || "Usuario"}
        />
      )}
    </div>
  )
}
