"use client"

import { useState, useEffect, useCallback, useRef } from "react"
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
  Shield,
  Link2,
  Copy,
  Check,
  ExternalLink,
  DollarSign,
  Pencil,
  Loader2,
  X,
  MoreHorizontal,
  Search,
  Receipt,
  Printer,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { CobrarOrdenDialog } from "@/components/ordenes/cobrar-orden-dialog"
import { PatternDisplay } from "@/components/ui/pattern-display"
import { useModal } from "@/contexts/modal-context"
import { toast } from "sonner"
import { getSupabaseClient } from "@/lib/supabase-client"
import type { RealtimeChannel } from "@supabase/supabase-js"
import type { OrdenServicio, EstadoOrden, User as UserType } from "@/types"

import { ESTADO_LABELS } from "@/lib/orden-state-machine"

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
  const [printingPdf, setPrintingPdf] = useState(false)
  const [activeTab, setActiveTab] = useState("repuestos")
  const [showEntregaDialog, setShowEntregaDialog] = useState(false)
  const [showCobrarDialog, setShowCobrarDialog] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [editingProblema, setEditingProblema] = useState(false)
  const [problemaText, setProblemaText] = useState("")
  const [savingProblema, setSavingProblema] = useState(false)
  const [editingDiagnostico, setEditingDiagnostico] = useState(false)
  const [diagnosticoText, setDiagnosticoText] = useState("")
  const [savingDiagnostico, setSavingDiagnostico] = useState(false)

  const isAdmin = session?.user?.role === "ADMIN"

  const seguimientoUrl = orden?.publicToken
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/seguimiento/${orden.publicToken}`
    : null

  const handleSaveProblema = async () => {
    if (!orden || problemaText.trim() === orden.problemaReportado) {
      setEditingProblema(false)
      return
    }
    setSavingProblema(true)
    try {
      const res = await fetch(`/api/ordenes/${orden.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ problemaReportado: problemaText.trim() }),
      })
      if (res.ok) {
        setOrden({ ...orden, problemaReportado: problemaText.trim() })
        setEditingProblema(false)
        toast.success("Problema reportado actualizado")
      } else {
        toast.error("Error al guardar")
      }
    } catch {
      toast.error("Error al guardar")
    } finally {
      setSavingProblema(false)
    }
  }

  const handleSaveDiagnostico = async () => {
    if (!orden || diagnosticoText.trim() === (orden.diagnostico || "")) {
      setEditingDiagnostico(false)
      return
    }
    setSavingDiagnostico(true)
    try {
      const res = await fetch(`/api/ordenes/${orden.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ diagnostico: diagnosticoText.trim() || null }),
      })
      if (res.ok) {
        setOrden({ ...orden, diagnostico: diagnosticoText.trim() || null })
        setEditingDiagnostico(false)
        toast.success("Diagnostico actualizado")
      } else {
        toast.error("Error al guardar")
      }
    } catch {
      toast.error("Error al guardar")
    } finally {
      setSavingDiagnostico(false)
    }
  }

  const handleCopyLink = async () => {
    if (!seguimientoUrl) return
    try {
      await navigator.clipboard.writeText(seguimientoUrl)
      setLinkCopied(true)
      toast.success("Link copiado al portapapeles")
      setTimeout(() => setLinkCopied(false), 2000)
    } catch {
      // fallback
    }
  }

  const handleShareWhatsApp = () => {
    if (!seguimientoUrl || !orden?.cliente?.telefono) return
    const codigoDisplay = orden.codigoOrden || `#${orden.numeroOrden}`
    const message = `Hola ${orden.cliente.nombre}, desde acá podés seguir el estado de tu equipo (Orden ${codigoDisplay}):\n${seguimientoUrl}`
    const phone = orden.cliente.telefono.replace(/\D/g, "")
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, "_blank")
  }

  const fetchOrden = useCallback(async () => {
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
  }, [ordenId, router])

  useEffect(() => {
    fetchOrden()
    fetchTecnicos()
  }, [ordenId, fetchOrden])

  // Realtime: re-fetch cuando cambia la orden o sus cotizaciones
  const channelRef = useRef<RealtimeChannel | null>(null)
  useEffect(() => {
    const supabase = getSupabaseClient()
    const channel = supabase
      .channel(`orden-detail-${ordenId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ordenes_servicio", filter: `id=eq.${ordenId}` },
        () => { fetchOrden() }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cotizaciones", filter: `orden_id=eq.${ordenId}` },
        () => { fetchOrden() }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orden_eventos", filter: `orden_id=eq.${ordenId}` },
        () => { fetchOrden() }
      )
      .subscribe()

    channelRef.current = channel
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [ordenId, fetchOrden])

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
        description: `¿Estás seguro de cambiar el estado a "${ESTADO_LABELS[nuevoEstado]}"? Esta acción puede ser difícil de revertir.`,
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
        toast.success("Estado actualizado")
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
    toast.success("Estado actualizado")
  }

  const handleReingreso = async () => {
    const confirmed = await confirm({
      title: "Re-ingreso por Garantía",
      description: "Se creará una nueva orden vinculada a esta como re-ingreso por garantía. ¿Desea continuar?",
      confirmText: "Crear Re-ingreso",
      variant: "info",
    })
    if (!confirmed) return

    setUpdating(true)
    try {
      const res = await fetch(`/api/ordenes/${ordenId}/reingreso`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          problemaReportado: `Re-ingreso: problema recurrente del equipo`,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        await alert({
          title: "Re-ingreso creado",
          description: `Se creó la orden ${data.codigoOrden || `#${data.numeroOrden}`}`,
          variant: "success",
        })
        router.push(`/ordenes/${data.id}`)
      } else {
        const error = await res.json()
        await alert({ title: "Error", description: error.error || "Error al crear re-ingreso", variant: "error" })
      }
    } catch {
      await alert({ title: "Error", description: "Error al crear re-ingreso", variant: "error" })
    } finally {
      setUpdating(false)
    }
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
        toast.success("Técnico asignado")
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
        toast.success("Actualizado")
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

  const handlePrintPdf = async () => {
    setPrintingPdf(true)
    try {
      const res = await fetch(`/api/ordenes/${ordenId}/pdf`)
      if (!res.ok) throw new Error("Error al generar PDF")
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const printWindow = window.open(url, "_blank")
      if (printWindow) {
        printWindow.addEventListener("load", () => {
          printWindow.print()
        })
      }
    } catch (error) {
      await alert({
        title: "Error",
        description: "No se pudo imprimir el PDF",
        variant: "error",
      })
    } finally {
      setPrintingPdf(false)
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
        toast.success("Orden eliminada")
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

  // ESPERANDO_REPUESTO es un sub-estado de EN_REPARACION, mapear al mismo índice
  const estadoParaProgreso = orden.estado === "ESPERANDO_REPUESTO" ? "EN_REPARACION" : orden.estado
  const currentEstadoIndex = estadoFlow.indexOf(estadoParaProgreso)
  const isRetiro = orden.estado === "ENTREGADO_SIN_REPARACION"
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
              {isRetiro ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                  <Package className="h-3 w-3" />
                  Retirado sin reparacion
                </span>
              ) : (
                <OrderStatusBadge status={orden.estado} showIcon />
              )}
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
          <Button variant="outline" size="sm" onClick={handlePrintPdf} disabled={printingPdf}>
            <Printer className="h-4 w-4 mr-2" />
            {printingPdf ? "..." : "Imprimir"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {isAdmin && (orden.estado === "REPARADO" || orden.estado === "ENTREGADO") && (
                <DropdownMenuItem onClick={handleGenerarFactura} disabled={updating}>
                  <Receipt className="h-4 w-4 mr-2" />
                  Generar Factura
                </DropdownMenuItem>
              )}
              {isAdmin && (orden.estado === "ENTREGADO" || orden.estado === "REPARADO") && !orden.esReingreso && (
                <DropdownMenuItem onClick={handleReingreso} disabled={updating}>
                  <Shield className="h-4 w-4 mr-2" />
                  Re-ingreso por Garantia
                </DropdownMenuItem>
              )}
              {isAdmin && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={handleDeleteOrden}
                    disabled={deleting}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Eliminar orden
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Banner de retiro sin reparación */}
      {isRetiro && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-sm">
          <Package className="h-4 w-4 text-amber-600 shrink-0" />
          <span className="text-amber-800 dark:text-amber-300">
            Retirado sin reparacion — El cliente retiro el equipo sin reparar.
          </span>
        </div>
      )}

      {/* Banner de re-ingreso */}
      {orden.esReingreso && orden.ordenOrigenId && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-sm">
          <Shield className="h-4 w-4 text-blue-600 shrink-0" />
          <span className="text-blue-800 dark:text-blue-300">
            Re-ingreso por garantia — Orden original:{" "}
            <Link href={`/ordenes/${orden.ordenOrigenId}`} className="underline hover:text-blue-600">
              ver orden original
            </Link>
          </span>
        </div>
      )}

      {/* Progress Bar */}
      {orden.estado !== "CANCELADO" && orden.estado !== "SIN_REPARACION" && !isRetiro && (
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

      {/* Mobile: Estado + Tecnico arriba */}
      <div className="lg:hidden space-y-4">
        <OrdenEstadoCard
          estado={orden.estado}
          fechaIngreso={orden.fechaIngreso}
          fechaPrometida={orden.fechaPrometida}
          fechaCompletado={orden.fechaCompletado}
          updating={updating}
          onUpdateEstado={handleUpdateEstado}
          esRetiro={isRetiro}
        />
        <OrdenTecnicoCard
          tecnicoId={orden.tecnicoId}
          tecnicos={tecnicos}
          updating={updating}
          onAsignarTecnico={handleAsignarTecnico}
        />
      </div>

      {/* Main Content - 2 columns */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column - Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Main Info Card */}
          <Card>
            <CardContent className="p-6">
              <div className="grid gap-6 md:grid-cols-2">
                {/* Cliente */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    <User className="h-3.5 w-3.5" />
                    Cliente
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
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    <Smartphone className="h-3.5 w-3.5" />
                    Dispositivo
                  </div>
                  <div className="space-y-2">
                    {orden.marca && (
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{orden.marca}</p>
                    )}
                    <h3 className="text-lg font-semibold">{orden.dispositivo}</h3>
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      <span className="px-2 py-0.5 bg-primary/10 text-primary rounded-full font-medium">{orden.tipoDispositivo}</span>
                      {orden.color && <span className="px-2 py-0.5 bg-muted rounded-full">{orden.color}</span>}
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
                      <div className="flex flex-wrap gap-1.5 text-xs mt-1">
                        {Object.entries(orden.metadata).map(([key, val]) => (
                          <span key={key} className="px-2 py-0.5 bg-muted rounded-full">
                            {key}: {String(val)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Problema Reportado */}
              <div className="mt-6 pt-6 border-t">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    <Wrench className="h-3.5 w-3.5" />
                    Problema Reportado
                  </div>
                  {!editingProblema && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setProblemaText(orden.problemaReportado || "")
                        setEditingProblema(true)
                      }}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  )}
                </div>
                {editingProblema ? (
                  <div className="space-y-2">
                    <textarea
                      className="w-full min-h-[80px] p-2 text-sm border rounded-md resize-y bg-background"
                      value={problemaText}
                      onChange={(e) => setProblemaText(e.target.value)}
                      disabled={savingProblema}
                      autoFocus
                    />
                    <div className="flex gap-2 justify-end">
                      <Button variant="ghost" size="sm" onClick={() => setEditingProblema(false)} disabled={savingProblema}>
                        <X className="h-3 w-3 mr-1" />Cancelar
                      </Button>
                      <Button size="sm" onClick={handleSaveProblema} disabled={savingProblema || !problemaText.trim()}>
                        {savingProblema ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Check className="h-3 w-3 mr-1" />}
                        Guardar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm whitespace-pre-wrap">{orden.problemaReportado}</p>
                )}
              </div>

              {/* Diagnostico - visible desde EN_DIAGNOSTICO en adelante */}
              {(orden.estado !== "RECIBIDO" || orden.diagnostico) && (
                <div className="mt-4 pt-4 border-t">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      <Search className="h-3.5 w-3.5" />
                      Diagnostico
                    </div>
                    {!editingDiagnostico && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          setDiagnosticoText(orden.diagnostico || "")
                          setEditingDiagnostico(true)
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                  {editingDiagnostico ? (
                    <div className="space-y-2">
                      <textarea
                        className="w-full min-h-[80px] p-2 text-sm border rounded-md resize-y bg-background"
                        value={diagnosticoText}
                        onChange={(e) => setDiagnosticoText(e.target.value)}
                        placeholder="Describir el diagnostico del equipo..."
                        disabled={savingDiagnostico}
                        autoFocus
                      />
                      <div className="flex gap-2 justify-end">
                        <Button variant="ghost" size="sm" onClick={() => setEditingDiagnostico(false)} disabled={savingDiagnostico}>
                          <X className="h-3 w-3 mr-1" />Cancelar
                        </Button>
                        <Button size="sm" onClick={handleSaveDiagnostico} disabled={savingDiagnostico}>
                          {savingDiagnostico ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Check className="h-3 w-3 mr-1" />}
                          Guardar
                        </Button>
                      </div>
                    </div>
                  ) : orden.diagnostico ? (
                    <p className="text-sm whitespace-pre-wrap">{orden.diagnostico}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">Sin diagnostico aun. Haz clic en el lapiz para agregar.</p>
                  )}
                </div>
              )}

              {/* Accesorios */}
              {orden.accesorios && (
                <div className="mt-4 pt-4 border-t">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Accesorios recibidos</div>
                  <p className="text-sm text-muted-foreground">{orden.accesorios}</p>
                </div>
              )}

              {/* Observaciones */}
              {orden.observaciones && (
                <div className="mt-4 pt-4 border-t">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Observaciones</div>
                  <p className="text-sm whitespace-pre-wrap">{orden.observaciones}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Tabs: Repuestos, Fotos, Checklist, Cotizaciones, Historial */}
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
                  <CotizacionList ordenId={ordenId} clienteEmail={orden.cliente?.email} readOnly={!isAdmin} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="historial" className="mt-4">
              <NotificationHistory ordenId={ordenId} />
            </TabsContent>
          </Tabs>

          {/* Garantia (no aplica para retiros sin reparación) */}
          {!isRetiro && (
            <GarantiaCard ordenId={ordenId} ordenEstado={orden.estado} />
          )}
        </div>

        {/* Right Column - Management (hidden on mobile, shown above) */}
        <div className="hidden lg:block space-y-6">
          <OrdenEstadoCard
            estado={orden.estado}
            fechaIngreso={orden.fechaIngreso}
            fechaPrometida={orden.fechaPrometida}
            fechaCompletado={orden.fechaCompletado}
            updating={updating}
            onUpdateEstado={handleUpdateEstado}
          />

          {/* Link de Seguimiento */}
          {seguimientoUrl && (
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-3">
                  <Link2 className="h-4 w-4" />
                  LINK DE SEGUIMIENTO
                </div>
                <div className="flex items-center gap-1.5 bg-muted rounded-md px-3 py-2 text-xs break-all mb-3">
                  <span className="flex-1 text-muted-foreground truncate">{seguimientoUrl}</span>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={handleCopyLink}>
                    {linkCopied ? <Check className="h-4 w-4 mr-1.5 text-green-500" /> : <Copy className="h-4 w-4 mr-1.5" />}
                    {linkCopied ? "Copiado" : "Copiar"}
                  </Button>
                  <Button variant="outline" size="sm" className="flex-1" onClick={handleShareWhatsApp}>
                    <ExternalLink className="h-4 w-4 mr-1.5" />
                    WhatsApp
                  </Button>
                  <Button variant="ghost" size="icon" className="shrink-0" asChild>
                    <a href={seguimientoUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

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
            totalCobrado={orden.totalCobrado || 0}
            descuentoCobro={orden.descuentoCobro || 0}
            estadoCobro={orden.estadoCobro}
            estado={orden.estado}
            origenPresupuesto={(orden as any).origenPresupuesto || null}
            onUpdateField={handleUpdateField}
            onCobrar={() => setShowCobrarDialog(true)}
          />
        </div>
      </div>

      {/* Mobile: Costos (below content) */}
      <div className="lg:hidden space-y-4">
        {seguimientoUrl && (
          <Card>
            <CardContent className="p-4">
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={handleCopyLink}>
                  {linkCopied ? <Check className="h-4 w-4 mr-1.5 text-green-500" /> : <Copy className="h-4 w-4 mr-1.5" />}
                  {linkCopied ? "Copiado" : "Copiar link"}
                </Button>
                <Button variant="outline" size="sm" className="flex-1" onClick={handleShareWhatsApp}>
                  <ExternalLink className="h-4 w-4 mr-1.5" />
                  WhatsApp
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
        <OrdenCostosCard
          ordenId={orden.id}
          presupuesto={orden.presupuesto}
          costoFinal={orden.costoFinal}
          sena={orden.sena || 0}
          totalCobrado={orden.totalCobrado || 0}
          descuentoCobro={orden.descuentoCobro || 0}
          estadoCobro={orden.estadoCobro}
          estado={orden.estado}
          origenPresupuesto={(orden as any).origenPresupuesto || null}
          onUpdateField={handleUpdateField}
          onCobrar={() => setShowCobrarDialog(true)}
        />
      </div>

      {/* Diálogo de Cobro */}
      {orden && orden.costoFinal && (
        <CobrarOrdenDialog
          open={showCobrarDialog}
          onOpenChange={setShowCobrarDialog}
          orden={{
            id: orden.id,
            numeroOrden: orden.numeroOrden,
            codigoOrden: orden.codigoOrden,
            costoFinal: orden.costoFinal || 0,
            totalCobrado: orden.totalCobrado || 0,
            estadoCobro: orden.estadoCobro || "PENDIENTE",
            descuentoCobro: orden.descuentoCobro || 0,
            clienteId: orden.cliente?.id,
            clienteNombre: orden.cliente?.nombre,
          }}
          onSuccess={() => fetchOrden()}
        />
      )}

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
            estadoCobro: orden.estadoCobro,
            pendienteCobro: (orden.costoFinal || 0) - (orden.descuentoCobro || 0) - (orden.totalCobrado || 0),
          }}
          encargadoNombre={session?.user?.name || "Usuario"}
          esRetiro={orden.estado === "SIN_REPARACION"}
        />
      )}
    </div>
  )
}

