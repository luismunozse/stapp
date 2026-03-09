"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { OrderStatusBadge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ArrowLeft,
  User,
  Phone,
  Mail,
  MapPin,
  Wrench,
  Trash2,
  FileText,
  FileDown,
  Smartphone,
  Camera,
  ClipboardCheck,
  Package,
  History,
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
import { OrdenEstadoCard } from "@/components/ordenes/orden-estado-card"
import { OrdenTecnicoCard } from "@/components/ordenes/orden-tecnico-card"
import { OrdenCostosCard } from "@/components/ordenes/orden-costos-card"
import { OrdenRepuestosTab } from "@/components/ordenes/orden-repuestos-tab"
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
  const [orden, setOrden] = useState<OrdenServicio | null>(null)
  const [tecnicos, setTecnicos] = useState<UserType[]>([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const [activeTab, setActiveTab] = useState("repuestos")
  const [showEntregaDialog, setShowEntregaDialog] = useState(false)

  const isAdmin = session?.user?.role === "ADMIN"

  useEffect(() => {
    fetchOrden()
    fetchTecnicos()
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
      const res = await fetch("/api/tecnicos", { cache: "no-store" })
      const data = await res.json()
      setTecnicos(data)
    } catch (error) {
      console.error("Error fetching tecnicos:", error)
    }
  }

  const handleUpdateEstado = async (nuevoEstado: EstadoOrden) => {
    if (nuevoEstado === "ENTREGADO") {
      setShowEntregaDialog(true)
      return
    }

    if (nuevoEstado === "CANCELADO" || nuevoEstado === "SIN_REPARACION") {
      const label = nuevoEstado === "CANCELADO" ? "Cancelar" : "Marcar Sin Reparación"
      const confirmed = await confirm({
        title: label,
        description: `¿Estás seguro de cambiar el estado a "${estadoLabels[nuevoEstado]}"? Esta acción puede ser difícil de revertir.`,
        confirmText: label,
        variant: "danger",
      })
      if (!confirmed) return
    }

    setUpdating(true)
    try {
      const res = await fetch(`/api/ordenes/${ordenId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: nuevoEstado }),
      })
      if (res.ok) {
        fetchOrden()
      } else {
        const error = await res.json()
        await alert({ title: "Error", description: error.error || "Error al actualizar estado", variant: "error" })
      }
    } catch (error) {
      console.error("Error updating estado:", error)
      await alert({ title: "Error", description: "Error al actualizar estado", variant: "error" })
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
      if (res.ok) {
        fetchOrden()
      } else {
        const error = await res.json()
        await alert({ title: "Error", description: error.error || "Error al asignar técnico", variant: "error" })
      }
    } catch (error) {
      console.error("Error assigning tecnico:", error)
      await alert({ title: "Error", description: "Error al asignar técnico", variant: "error" })
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
      if (res.ok) {
        fetchOrden()
      } else {
        const error = await res.json()
        await alert({ title: "Error", description: error.error || "Error al actualizar", variant: "error" })
      }
    } catch (error) {
      console.error(`Error updating ${field}:`, error)
      await alert({ title: "Error", description: "Error al actualizar", variant: "error" })
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
      a.download = `orden-${orden?.codigoOrden || orden?.numeroOrden}.pdf`
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
    if (!orden) return
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
              organizationName: (orden as any).organizationName || "",
              orden: {
                id: orden.id,
                numeroOrden: orden.numeroOrden,
                estado: orden.estado,
                dispositivo: orden.dispositivo,
                presupuesto: orden.presupuesto,
                fechaCompletado: orden.fechaCompletado ? new Date(orden.fechaCompletado as any) : null,
              },
              cliente: {
                id: orden.cliente!.id,
                nombre: orden.cliente!.nombre,
                email: orden.cliente!.email,
                telefono: orden.cliente!.telefono,
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
                    <h3 className="text-lg font-semibold">{orden.cliente?.nombre}</h3>
                    <div className="flex items-center gap-2 text-sm">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <a href={`tel:${orden.cliente?.telefono}`} className="hover:text-primary">
                        {orden.cliente?.telefono}
                      </a>
                    </div>
                    {orden.cliente?.email && (
                      <div className="flex items-center gap-2 text-sm">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground">{orden.cliente.email}</span>
                      </div>
                    )}
                    {orden.cliente?.direccion && (
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
                        <span className="text-muted-foreground">Contrasena: </span>
                        {orden.codigoAccesoDispositivo.startsWith("Patron:") ? (
                          <PatternDisplay value={orden.codigoAccesoDispositivo} size={80} />
                        ) : (
                          <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{orden.codigoAccesoDispositivo}</code>
                        )}
                      </div>
                    )}
                    {orden.metadata && Object.keys(orden.metadata).length > 0 && (
                      <div className="flex flex-wrap gap-2 text-sm mt-1">
                        {Object.entries(orden.metadata).map(([key, val]) => (
                          <span key={key} className="px-2 py-0.5 bg-muted rounded">
                            {key}: {String(val)}
                          </span>
                        ))}
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
              <OrdenRepuestosTab
                ordenId={ordenId}
                repuestos={(orden as any).repuestos || []}
                onRepuestosChanged={fetchOrden}
              />
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
          <OrdenEstadoCard
            estado={orden.estado}
            fechaIngreso={orden.fechaIngreso}
            fechaPrometida={orden.fechaPrometida}
            fechaCompletado={orden.fechaCompletado}
            updating={updating}
            onUpdateEstado={handleUpdateEstado}
          />

          <OrdenTecnicoCard
            tecnicoId={orden.tecnicoId}
            tecnicos={tecnicos}
            updating={updating}
            onAsignarTecnico={handleAsignarTecnico}
          />

          <OrdenCostosCard
            ordenId={orden.id}
            presupuesto={orden.presupuesto}
            costoFinal={orden.costoFinal}
            sena={orden.sena || 0}
            onUpdateField={handleUpdateField}
          />

          {/* Facturación */}
          {(orden.estado === "REPARADO" || orden.estado === "ENTREGADO") && (
            <Card>
              <CardContent className="p-6">
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
