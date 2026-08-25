"use client"

import { useState, useEffect, useCallback } from "react"
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
  Hammer,
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
  MoreHorizontal,
  Search,
  Receipt,
  Printer,
  Tag,
  BadgeCheck,
  HandCoins,
  Lock,
  AlertTriangle,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import Link from "next/link"
import { useCurrency, useTerminologia } from "@/contexts/currency-context"
import { generateWhatsAppUrl } from "@/lib/notifications/whatsapp-templates"
import { CotizacionList } from "@/components/cotizaciones/cotizacion-list"
import { GarantiaCard } from "@/components/garantias/garantia-card"
import { FotoGallery } from "@/components/fotos/foto-gallery"
import { ChecklistCard } from "@/components/checklist/checklist-card"
import { WhatsAppDialog } from "@/components/ordenes/whatsapp-dialog"
import { EntregaDialog } from "@/components/ordenes/entrega-dialog"
import {
  printDeviceLabel,
  readEtiquetaSize,
  saveEtiquetaSize,
  LABEL_SIZE_OPTIONS,
  DEFAULT_LABEL_SIZE,
  type LabelSize,
} from "@/components/ordenes/print-label"
import { ThermalPrintOrden } from "@/components/ordenes/thermal-print-orden"
import { NotificationHistory } from "@/components/ordenes/notification-history"
import { OrdenEstadoCard } from "@/components/ordenes/orden-estado-card"
import { OrdenTecnicoCard } from "@/components/ordenes/orden-tecnico-card"
import { OrdenCostosCard } from "@/components/ordenes/orden-costos-card"
import { OrdenComisionCard } from "@/components/ordenes/orden-comision-card"
import { OrdenRepuestosTab } from "@/components/ordenes/orden-repuestos-tab"
import { OrdenServiciosTab } from "@/components/ordenes/orden-servicios-tab"
import { CobrarOrdenDialog } from "@/components/ordenes/cobrar-orden-dialog"
import { ConfirmarReparadoDialog } from "@/components/ordenes/confirmar-reparado-dialog"
import { NotaCreditoDialog } from "@/components/notas-credito/nota-credito-dialog"
import { PatternDisplay } from "@/components/ui/pattern-display"
import { StatusBanner } from "@/components/ui/status-banner"
import { MOTIVO_SIN_COBRO_LABELS, type MotivoSinCobro } from "@/lib/seguimiento-state"
import { FieldSectionLabel } from "@/components/ui/field-section-label"
import { EditableTextField } from "@/components/ui/editable-text-field"
import { useModal } from "@/contexts/modal-context"
import { toast } from "sonner"
import { useVisibilityPolling } from "@/hooks/use-visibility-polling"
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
  const term = useTerminologia()
  const { formatPrice, formatDate, currency, timezone, pais } = useCurrency()
  const [orden, setOrden] = useState<OrdenServicio | null>(null)
  const [tecnicos, setTecnicos] = useState<UserType[]>([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const [printingPdf, setPrintingPdf] = useState(false)
  const [activeTab, setActiveTab] = useState("repuestos")
  const [showEntregaDialog, setShowEntregaDialog] = useState(false)
  const [sinCobroEntrega, setSinCobroEntrega] = useState(false)
  const [showCobrarDialog, setShowCobrarDialog] = useState(false)
  const [showReparadoDialog, setShowReparadoDialog] = useState(false)
  const [showNCDialog, setShowNCDialog] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [etiquetaSize, setEtiquetaSize] = useState<LabelSize>(DEFAULT_LABEL_SIZE)

  useEffect(() => {
    setEtiquetaSize(readEtiquetaSize())
  }, [])

  const isAdmin = session?.user?.role === "ADMIN"
  const userRole = session?.user?.role

  const seguimientoUrl = orden?.publicToken
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/seguimiento/${orden.publicToken}`
    : null

  // Persist a single order text field. Returns true on success/no-op (closes the
  // editor), false on error (keeps it open). Used by EditableTextField.
  const saveOrdenField = async (
    body: Record<string, unknown>,
    patch: Partial<OrdenServicio>,
    successMsg: string
  ): Promise<boolean> => {
    if (!orden) return false
    try {
      const res = await fetch(`/api/ordenes/${orden.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        setOrden({ ...orden, ...patch })
        toast.success(successMsg)
        return true
      }
      toast.error("Error al guardar")
      return false
    } catch {
      toast.error("Error al guardar")
      return false
    }
  }

  const handleSaveProblema = async (next: string): Promise<boolean> => {
    const value = next.trim()
    if (!orden || value === orden.problemaReportado) return true
    return saveOrdenField(
      { problemaReportado: value },
      { problemaReportado: value },
      "Problema reportado actualizado"
    )
  }

  const handleSaveDiagnostico = async (next: string): Promise<boolean> => {
    const value = next.trim() || null
    if (!orden || (value || "") === (orden.diagnostico || "")) return true
    return saveOrdenField(
      { diagnostico: value },
      { diagnostico: value },
      "Diagnostico actualizado"
    )
  }

  const handleSaveNotasInternas = async (next: string): Promise<boolean> => {
    const value = next.trim() || null
    if (!orden || (value || "") === (orden.notasInternas || "")) return true
    return saveOrdenField(
      { notasInternas: value },
      { notasInternas: value },
      "Notas internas actualizadas"
    )
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

  const handleShareWhatsApp = async () => {
    const contactPhone = orden?.telefonoContacto || orden?.cliente?.telefono
    if (!seguimientoUrl || !contactPhone) return
    const codigoDisplay = orden.codigoOrden || `#${orden.numeroOrden}`

    let message: string
    try {
      const [{ resolvePlantilla }, configRes] = await Promise.all([
        import("@/lib/whatsapp/plantillas-catalog"),
        fetch("/api/notificaciones/config"),
      ])
      const config = configRes.ok ? await configRes.json() : null
      message = resolvePlantilla(
        "orden_compartir_seguimiento",
        {
          cliente: orden.cliente?.nombre || "",
          codigo_orden: codigoDisplay,
          link_seguimiento_publico: seguimientoUrl,
          empresa: (orden as any).organizationName || (orden as any).organization?.nombre || "",
        },
        config?.plantillasWhatsapp ?? null,
      )
    } catch {
      message = `Hola ${orden.cliente?.nombre}, desde acá podés seguir el estado de tu equipo (Orden ${codigoDisplay}):\n${seguimientoUrl}`
    }

    window.open(generateWhatsAppUrl(contactPhone, message, pais), "_blank")
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
      // `id` fijo: evita apilar un toast por cada intento fallido del polling
      // de 15s (useVisibilityPolling), en vez de solo loguear en consola.
      toast.error("No se pudo actualizar la orden", { id: "fetch-orden-error" })
    } finally {
      setLoading(false)
    }
  }, [ordenId, router])

  useEffect(() => {
    fetchOrden()
    fetchTecnicos()
  }, [ordenId, fetchOrden])

  // Polling: re-fetch the orden every 15 seconds while the tab is visible.
  // Previously used Supabase Realtime with an HS256-minted JWT (PR3), which
  // was abandoned because the production Supabase project uses asymmetric JWT
  // signing (ECC P-256) — HS256 tokens are rejected with JwtSignatureError.
  useVisibilityPolling(fetchOrden, 15000, Boolean(ordenId))

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
    // ENTREGADO_SIN_REPARACION comparte el flujo de entrega: el backend lo
    // deriva de esRetiro (SIN_REPARACION + entrega con cobro). Sin este caso,
    // el estado caía al PUT genérico y se salteaba fecha de entrega, cargo a
    // cuenta corriente, consumo de reservas y firmas.
    if (nuevoEstado === "ENTREGADO" || nuevoEstado === "ENTREGADO_SIN_REPARACION") {
      setSinCobroEntrega(false)
      setShowEntregaDialog(true)
      return
    }

    if (nuevoEstado === "ENTREGADO_SIN_COBRO") {
      setSinCobroEntrega(true)
      setShowEntregaDialog(true)
      return
    }

    // REPARADO abre un modal de cierre de precio (captura costo_final + marca
    // reparado en un solo PUT) en vez del PUT directo, que fallaba con 400
    // cuando la orden venía sin costo del flujo express.
    if (nuevoEstado === "REPARADO") {
      setShowReparadoDialog(true)
      return
    }

    if (nuevoEstado === "CANCELADO" || nuevoEstado === "SIN_REPARACION") {
      const label = nuevoEstado === "CANCELADO" ? "Cancelar" : "Marcar Sin Reparación"
      const totalCobrado = orden?.totalCobrado || 0
      const tieneCobros = totalCobrado > 0
      const desc = tieneCobros
        ? `⚠️ Esta orden tiene ${formatPrice(totalCobrado)} cobrados. Si cancelás sin anular esos cobros, quedan como ingreso real en finanzas (no se descuentan automáticamente). Revisá la pestaña Cobros y anulá los que correspondan o registrá un reembolso manual en Caja antes de proceder.`
        : `¿Estás seguro de cambiar el estado a "${ESTADO_LABELS[nuevoEstado]}"? Esta acción puede ser difícil de revertir.`
      const confirmed = await confirm({
        title: label,
        description: desc,
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

  const handleEntregaSuccess = async (pendienteCobro?: number) => {
    setShowEntregaDialog(false)
    // Refrescar ANTES de abrir el cobro: el diálogo lee costoFinal del estado,
    // y en la entrega puede haberse confirmado un total distinto al que tenía.
    await fetchOrden()
    toast.success("Estado actualizado")

    // El cobro es parte del flujo de entrega, no un trámite aparte: si quedó
    // saldo, se abre solo. Sigue siendo opcional — cerrarlo deja el saldo en
    // la cuenta corriente del cliente, igual que antes.
    if (!sinCobroEntrega && (pendienteCobro ?? 0) > 0) {
      setShowCobrarDialog(true)
    }
    setSinCobroEntrega(false)
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
      title: "Generar remito",
      description: "¿Generar remito para esta orden?",
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
          title: "Remito generado",
          description: "El remito se generó correctamente",
          variant: "success",
        })
        router.push("/facturacion")
      } else {
        const error = await res.json()
        await alert({
          title: "Error",
          description: error.error || "Error al generar remito",
          variant: "error",
        })
      }
    } catch (error) {
      await alert({
        title: "Error",
        description: "Error al generar remito",
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
      window.open(url, "_blank")
    } catch (error) {
      await alert({
        title: "Error",
        description: "No se pudo abrir el PDF",
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
  const isSinCobro = orden.estado === "ENTREGADO_SIN_COBRO"
  const progressPercentage = orden.estado === "CANCELADO" || orden.estado === "SIN_REPARACION"
    ? 0
    : Math.round(((currentEstadoIndex + 1) / estadoFlow.length) * 100)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
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
            context={(() => {
              const o: any = orden
              const slug = (() => {
                if (typeof window === "undefined") return undefined
                const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"
                const h = window.location.hostname
                return h.endsWith(`.${rootDomain}`) ? h.replace(`.${rootDomain}`, "") : undefined
              })()
              // Garantía vigente (la más reciente activa)
              const garantiasArr: any[] = Array.isArray(o.garantia) ? o.garantia : (o.garantia ? [o.garantia] : [])
              const gActiva = garantiasArr
                .filter((g) => g && g.estado === "ACTIVA")
                .sort((a, b) => new Date(b.fecha_vencimiento).getTime() - new Date(a.fecha_vencimiento).getTime())[0]
              // Saldo pendiente derivado de cobros vs costo
              const baseTotal = Number(o.costoFinal ?? o.presupuesto ?? 0)
              const cobrado = Number(o.totalCobrado ?? 0) + Number(o.sena ?? 0) - Number(o.descuentoCobro ?? 0)
              const saldoPendiente = Math.max(0, baseTotal - cobrado)
              // Demora: fechaPrometida pasada y no entregada
              const fechaPromTs = o.fechaPrometida ? new Date(o.fechaPrometida).getTime() : null
              const entregada = ["ENTREGADO", "ENTREGADO_SIN_REPARACION", "ENTREGADO_SIN_COBRO", "CANCELADO"].includes(o.estado)
              const esDemora = fechaPromTs != null && fechaPromTs < Date.now() && !entregada
              return {
                organizationId: session?.user?.organizationId || o.organizationId || "",
                organizationName: o.organizationName || "",
                organizationSlug: slug,
                moneda: o.organizationMoneda || currency,
                zonaHoraria: o.organizationZonaHoraria || timezone,
                cliente: {
                  id: o.cliente!.id,
                  nombre: o.cliente!.nombre,
                  email: o.cliente!.email,
                  telefono: o.cliente!.telefono,
                  telefonoContacto: o.telefonoContacto,
                },
                orden: {
                  id: o.id,
                  numeroOrden: o.numeroOrden,
                  estado: o.estado,
                  estadoAnterior: o.estadoAnterior ?? undefined,
                  dispositivo: o.dispositivo,
                  presupuesto: o.presupuesto,
                  fechaCompletado: o.fechaCompletado ? new Date(o.fechaCompletado) : null,
                  publicToken: o.publicToken,
                },
                ...(gActiva && {
                  garantia: {
                    id: gActiva.id,
                    diasValidez: gActiva.dias_validez,
                    fechaVencimiento: new Date(gActiva.fecha_vencimiento),
                  },
                }),
                ...(saldoPendiente > 0 && {
                  pago: {
                    monto: 0,
                    saldoPendiente,
                  },
                }),
                ...(esDemora && {
                  demora: {
                    motivo: `La fecha estimada de entrega (${formatDate(o.fechaPrometida)}) ya pasó`,
                  },
                }),
              }
            })()}
          />
          <Button variant="outline" size="sm" onClick={handleDownloadPdf} disabled={downloadingPdf}>
            <FileDown className="h-4 w-4 mr-2" />
            {downloadingPdf ? "..." : "PDF"}
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrintPdf} disabled={printingPdf}>
            <Printer className="h-4 w-4 mr-2" />
            {printingPdf ? "..." : "Imprimir"}
          </Button>
          <ThermalPrintOrden orden={orden as any} />
          <select
            value={etiquetaSize}
            onChange={(e) => {
              const s = e.target.value as LabelSize
              setEtiquetaSize(s)
              saveEtiquetaSize(s)
            }}
            className="h-9 rounded-md border bg-background px-2 text-xs"
            title="Tamaño de etiqueta (térmica): elegí según tu impresora"
          >
            {LABEL_SIZE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const baseUrl = window.location.origin
              const fecha = orden.fechaIngreso
                ? new Date(orden.fechaIngreso).toLocaleDateString("es-AR", { timeZone: timezone })
                : new Date().toLocaleDateString("es-AR", { timeZone: timezone })
              printDeviceLabel({
                codigoOrden: orden.codigoOrden || `#${orden.numeroOrden}`,
                numeroOrden: orden.numeroOrden,
                clienteNombre: orden.cliente?.nombre || "",
                dispositivo: orden.dispositivo,
                problemaReportado: orden.problemaReportado,
                fechaIngreso: fecha,
                publicToken: orden.publicToken,
                organizationName: undefined,
              }, baseUrl, { size: etiquetaSize })
            }}
            title="Imprimir etiqueta para el equipo"
          >
            <Tag className="h-4 w-4 mr-2" />
            Etiqueta
          </Button>
          {orden.estado === "REPARADO" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const baseUrl = window.location.origin
                const fechaRep = orden.fechaCompletado
                  ? new Date(orden.fechaCompletado).toLocaleDateString("es-AR", { timeZone: timezone })
                  : new Date().toLocaleDateString("es-AR", { timeZone: timezone })
                printDeviceLabel({
                  codigoOrden: orden.codigoOrden || `#${orden.numeroOrden}`,
                  numeroOrden: orden.numeroOrden,
                  clienteNombre: orden.cliente?.nombre || "",
                  dispositivo: orden.dispositivo,
                  problemaReportado: orden.problemaReportado,
                  fechaIngreso: fechaRep,
                  publicToken: orden.publicToken,
                  organizationName: undefined,
                  variant: "reparado",
                  fechaReparacion: fechaRep,
                }, baseUrl, { size: etiquetaSize })
              }}
              title="Imprimir etiqueta de reparado para pegar en el equipo"
            >
              <BadgeCheck className="h-4 w-4 mr-2" />
              Etiqueta Reparado
            </Button>
          )}
          {isAdmin && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {(orden.estado === "REPARADO" || orden.estado === "ENTREGADO") && (
                  <DropdownMenuItem onClick={handleGenerarFactura} disabled={updating}>
                    <Receipt className="h-4 w-4 mr-2" />
                    Generar Remito
                  </DropdownMenuItem>
                )}
                {(orden.estado === "ENTREGADO" || orden.estado === "REPARADO") && !orden.esReingreso && (
                  <DropdownMenuItem onClick={handleReingreso} disabled={updating}>
                    <Shield className="h-4 w-4 mr-2" />
                    Re-ingreso por Garantia
                  </DropdownMenuItem>
                )}
                {(orden.totalCobrado || 0) > 0 && (
                  <DropdownMenuItem onClick={() => setShowNCDialog(true)}>
                    <Receipt className="h-4 w-4 mr-2" />
                    Emitir nota de crédito
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={handleDeleteOrden}
                  disabled={deleting}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Eliminar orden
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Banner de retiro sin reparación */}
      {isRetiro && (
        <StatusBanner tone="warning" icon={Package}>
          Retirado sin reparacion — El cliente retiro el equipo sin reparar.
        </StatusBanner>
      )}

      {/* Banner de entrega sin cobro */}
      {isSinCobro && (
        <StatusBanner tone="success" icon={HandCoins}>
          Entregado sin cobro — El equipo fue entregado al cliente sin cargo.
          {orden.motivoSinCobro &&
            ` Motivo: ${MOTIVO_SIN_COBRO_LABELS[orden.motivoSinCobro as MotivoSinCobro] || orden.motivoSinCobro}.`}
        </StatusBanner>
      )}

      {/* Banner de re-ingreso */}
      {orden.esReingreso && orden.ordenOrigenId && (
        <StatusBanner tone="info" icon={Shield}>
          Re-ingreso por garantia — Orden original:{" "}
          <Link href={`/ordenes/${orden.ordenOrigenId}`} className="underline hover:text-blue-600">
            ver orden original
          </Link>
        </StatusBanner>
      )}

      {/* Progress Bar */}
      {orden.estado !== "CANCELADO" && orden.estado !== "SIN_REPARACION" && !isRetiro && !isSinCobro && (
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
          readOnly={userRole === "TECNICO"}
        />
        {(orden as any).recibidoPor && (
          <Card>
            <CardContent className="p-4">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                Recibido por
              </div>
              <p className="text-sm font-medium">{(orden as any).recibidoPor.nombre}</p>
            </CardContent>
          </Card>
        )}
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
                  <FieldSectionLabel icon={User}>Cliente</FieldSectionLabel>
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
                  <FieldSectionLabel icon={Smartphone}>{term("equipo")}</FieldSectionLabel>
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
                        <span className="text-muted-foreground">{term("serie")}: </span>
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
                <EditableTextField
                  icon={Wrench}
                  label="Problema Reportado"
                  value={orden.problemaReportado || ""}
                  onSave={handleSaveProblema}
                  requireValue
                />
              </div>

              {/* Diagnostico - visible desde EN_DIAGNOSTICO en adelante */}
              {(orden.estado !== "RECIBIDO" || orden.diagnostico) && (
                <div className="mt-4 pt-4 border-t">
                  <EditableTextField
                    icon={Search}
                    label="Diagnostico"
                    value={orden.diagnostico || ""}
                    onSave={handleSaveDiagnostico}
                    placeholder="Describir el diagnostico del equipo..."
                    emptyHint="Sin diagnostico aun. Haz clic en el lapiz para agregar."
                  />
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

              {/* Notas internas - solo uso interno, no visible al cliente */}
              <div className="mt-4 pt-4 border-t">
                <EditableTextField
                  icon={Lock}
                  label={
                    <>
                      Notas internas
                      <span className="text-[10px] font-normal normal-case text-muted-foreground">(no visibles para el cliente)</span>
                    </>
                  }
                  value={orden.notasInternas || ""}
                  onSave={handleSaveNotasInternas}
                  placeholder="Notas privadas del equipo (no se muestran al cliente)..."
                  emptyHint="Sin notas internas. Haz clic en el lapiz para agregar."
                  textareaClassName="bg-amber-50/40 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900"
                  valueClassName="bg-amber-50/40 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-md p-2"
                />
              </div>
            </CardContent>
          </Card>

          {/* Tabs: Repuestos, Fotos, Checklist, Cotizaciones, Historial */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full justify-start overflow-x-auto flex-nowrap">
              <TabsTrigger value="repuestos" className="gap-2">
                <Package className="h-4 w-4" />
                Repuestos
              </TabsTrigger>
              {/* Servicios mueve el presupuesto y el costo final de la orden,
                  asi que el panel es solo ADMIN. El trigger sigue al panel: si
                  se muestra sin el, el tecnico abre una pestana vacia. */}
              {isAdmin && (
                <TabsTrigger value="servicios" className="gap-2">
                  <Hammer className="h-4 w-4" />
                  Servicios
                </TabsTrigger>
              )}
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
                mostrarCostos={isAdmin}
                ordenEstado={orden.estado}
                onRepuestosChanged={fetchOrden}
              />
            </TabsContent>

            <TabsContent value="servicios" className="mt-4">
              {isAdmin && (
                <OrdenServiciosTab
                  ordenId={ordenId}
                  servicios={(orden as any).servicios || []}
                  costoFinal={orden.costoFinal ?? null}
                  presupuesto={orden.presupuesto ?? null}
                  estado={orden.estado}
                  totalCobrado={orden.totalCobrado || 0}
                  onServiciosChanged={fetchOrden}
                />
              )}
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
                  <CotizacionList ordenId={ordenId} clienteEmail={orden.cliente?.email} readOnly={!isAdmin && userRole !== "TECNICO"} repuestos={(orden as any).repuestos || []} mostrarCostos={isAdmin} onOrdenChanged={fetchOrden} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="historial" className="mt-4">
              <NotificationHistory ordenId={ordenId} />
            </TabsContent>
          </Tabs>

          {/* Garantia (no aplica para retiros ni sin cobro) */}
          {!isRetiro && !isSinCobro && (
            <GarantiaCard ordenId={ordenId} ordenEstado={orden.estado} garantiaDiasDefault={(orden as any).organizationGarantiaDiasDefault ?? 30} />
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
          {(orden as any).recibidoPor && (
            <Card>
              <CardContent className="p-4">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                  Recibido por
                </div>
                <p className="text-sm font-medium">{(orden as any).recibidoPor.nombre}</p>
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
            readOnly={userRole === "TECNICO"}
          />

          {isAdmin && <DobleCargaWarning orden={orden} />}

          {isAdmin && (
            <OrdenComisionCard
              ordenId={orden.id}
              tecnicoId={orden.tecnicoId}
              costoFinal={orden.costoFinal}
              repuestos={(orden as any).repuestos || []}
              costoRepuestosExtra={(orden as any).costoRepuestosCotizaciones || 0}
              porcentajeComision={(orden as any).porcentajeComision}
              comisionPagada={(orden as any).comisionPagada}
              fechaPagoComision={(orden as any).fechaPagoComision}
              horasTrabajadas={(orden as any).horasTrabajadas || 0}
              onUpdateField={handleUpdateField}
            />
          )}
        </div>
      </div>

      {isAdmin && (
        <div className="lg:hidden">
          <DobleCargaWarning orden={orden} />
        </div>
      )}

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
          readOnly={userRole === "TECNICO"}
        />
        {isAdmin && (
          <OrdenComisionCard
            ordenId={orden.id}
            tecnicoId={orden.tecnicoId}
            costoFinal={orden.costoFinal}
            repuestos={(orden as any).repuestos || []}
            costoRepuestosExtra={(orden as any).costoRepuestosCotizaciones || 0}
            porcentajeComision={(orden as any).porcentajeComision}
            comisionPagada={(orden as any).comisionPagada}
            fechaPagoComision={(orden as any).fechaPagoComision}
            horasTrabajadas={(orden as any).horasTrabajadas || 0}
            onUpdateField={handleUpdateField}
          />
        )}
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

      {orden && (
        <ConfirmarReparadoDialog
          open={showReparadoDialog}
          onOpenChange={setShowReparadoDialog}
          orden={{
            id: orden.id,
            numeroOrden: orden.numeroOrden,
            codigoOrden: orden.codigoOrden,
            presupuesto: orden.presupuesto,
            costoFinal: orden.costoFinal,
            sena: orden.sena || 0,
            totalCobrado: orden.totalCobrado || 0,
            descuentoCobro: orden.descuentoCobro || 0,
            clienteNombre: orden.cliente?.nombre,
            dispositivo: orden.dispositivo,
            problemaReportado: orden.problemaReportado,
            publicToken: orden.publicToken,
          }}
          onSuccess={() => {
            fetchOrden()
            toast.success("Orden marcada como reparada")
          }}
        />
      )}

      {orden && showNCDialog && (
        <NotaCreditoDialog
          open={showNCDialog}
          onOpenChange={setShowNCDialog}
          ordenId={orden.id}
          montoMaximo={orden.totalCobrado || 0}
          onSuccess={() => fetchOrden()}
        />
      )}

      {/* Diálogo de Entrega con Firma */}
      {orden && (
        <EntregaDialog
          open={showEntregaDialog}
          onClose={() => { setShowEntregaDialog(false); setSinCobroEntrega(false) }}
          onSuccess={handleEntregaSuccess}
          orden={{
            id: orden.id,
            numeroOrden: orden.numeroOrden,
            codigoOrden: orden.codigoOrden,
            dispositivo: orden.dispositivo,
            estado: orden.estado,
            cliente: {
              nombre: orden.cliente?.nombre || "Sin nombre",
              telefono: orden.cliente?.telefono || "",
            },
            estadoCobro: orden.estadoCobro,
            pendienteCobro: (orden.costoFinal || 0) - (orden.descuentoCobro || 0) - (orden.totalCobrado || 0),
            costoFinal: orden.costoFinal,
            repuestos: (orden as any).repuestos || [],
          }}
          encargadoNombre={session?.user?.name || "Usuario"}
          esRetiro={orden.estado === "SIN_REPARACION" && !sinCobroEntrega}
          sinCobro={sinCobroEntrega}
          garantiaDiasDefault={(orden as any).organizationGarantiaDiasDefault ?? 30}
        />
      )}

    </div>
  )
}

// Warning si mismo item de inventario aparece en repuestos_orden Y en cotización ACEPTADA.
// Provoca doble cuento de costo en reportes. Admin debe quitar de uno de los dos lados.
function DobleCargaWarning({ orden }: { orden: any }) {
  const repuestoIds = new Set<string>(
    ((orden as any).repuestos || [])
      .map((r: any) => r.inventarioId)
      .filter((id: any): id is string => !!id)
  )
  const cotizaciones = ((orden as any).cotizaciones || []) as any[]
  const duplicados: Array<{ id: string; nombre: string }> = []
  const vistos = new Set<string>()
  for (const c of cotizaciones) {
    if (c.deleted_at || c.estado !== "ACEPTADA") continue
    const items = (c.items_cotizacion || []) as any[]
    for (const it of items) {
      const invId = it.inventario_id
      if (!invId || !repuestoIds.has(invId) || vistos.has(invId)) continue
      vistos.add(invId)
      duplicados.push({ id: invId, nombre: it.descripcion || it.inventario?.nombre || "Item" })
    }
  }
  if (duplicados.length === 0) return null
  return (
    <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg p-3">
      <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
      <div>
        <div className="font-medium mb-1">Posible doble carga de repuestos</div>
        <div>
          {duplicados.length === 1 ? "El item " : "Los items "}
          <strong>{duplicados.map((d) => d.nombre).join(", ")}</strong>
          {duplicados.length === 1 ? " está" : " están"} en una cotización ACEPTADA y también en el tab Repuestos.
          Reportes de costo lo van a contar dos veces. Eliminá de un lado.
        </div>
      </div>
    </div>
  )
}

