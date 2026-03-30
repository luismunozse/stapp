"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import dynamic from "next/dynamic"
import Image from "next/image"
import { formatDateValue } from "@/lib/timezone"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Smartphone,
  Monitor,
  Tablet,
  Gamepad2,
  Watch,
  Printer,
  Tv,
  Camera,
  Headphones,
  Router,
  HardDrive,
  Cpu,
  Refrigerator,
  Microwave,
  WashingMachine,
  Wind,
  AirVent,
  Plug,
  Fan,
  Projector,
  ScanLine,
  Zap,
  Snowflake,
  CheckCircle2,
  Circle,
  Phone,
  MapPin,
  Wrench,
  Loader2,
  AlertCircle,
  XCircle,
  Calendar,
  Package,
  ClipboardCheck,
  Search,
  ThumbsUp,
  Settings,
  Clock,
  Truck,
  Download,
  MessageCircle,
  Timer,
  ArrowRight,
  Sparkles,
} from "lucide-react"
import { getSupabaseClient } from "@/lib/supabase-client"
import type { RealtimeChannel } from "@supabase/supabase-js"

// Lazy load enhanced components
const VisualTimeline = dynamic(
  () => import("./visual-timeline").then((mod) => ({ default: mod.VisualTimeline })),
  { loading: () => <TimelineSkeleton />, ssr: false }
)

const PhotoGallery = dynamic(
  () => import("./photo-gallery").then((mod) => ({ default: mod.PhotoGallery })),
  { loading: () => <div className="py-4 text-center text-muted-foreground">Cargando fotos...</div>, ssr: false }
)

const BudgetApproval = dynamic(
  () => import("./budget-approval").then((mod) => ({ default: mod.BudgetApproval })),
  { loading: () => null, ssr: false }
)

const CotizacionApproval = dynamic(
  () => import("./cotizacion-approval").then((mod) => ({ default: mod.CotizacionApproval })),
  { loading: () => null, ssr: false }
)

const WarrantyInfo = dynamic(
  () => import("./warranty-info").then((mod) => ({ default: mod.WarrantyInfo })),
  { loading: () => null, ssr: false }
)

function TimelineSkeleton() {
  return (
    <div className="py-4 text-center text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin mx-auto" />
    </div>
  )
}

const estadoLabels: Record<string, string> = {
  RECIBIDO: "Recibido",
  EN_DIAGNOSTICO: "En diagnostico",
  PRESUPUESTADO: "Presupuestado",
  APROBADO: "Aprobado",
  EN_REPARACION: "En reparacion",
  ESPERANDO_REPUESTO: "Esperando repuesto",
  REPARADO: "Listo para retirar",
  ENTREGADO: "Entregado",
  CANCELADO: "Cancelado",
  SIN_REPARACION: "Sin reparacion",
}

const estadoDescriptions: Record<string, string> = {
  RECIBIDO: "Tu equipo fue recibido en el taller. Pronto comenzaremos a revisarlo.",
  EN_DIAGNOSTICO: "Un tecnico esta evaluando tu equipo para determinar la falla.",
  PRESUPUESTADO: "Ya tenemos el presupuesto de la reparacion. Esperamos tu aprobacion.",
  APROBADO: "Presupuesto aprobado. Tu equipo entrara en reparacion a la brevedad.",
  EN_REPARACION: "Nuestro tecnico esta trabajando en tu equipo.",
  ESPERANDO_REPUESTO: "Estamos esperando la llegada de un repuesto necesario.",
  REPARADO: "Tu equipo esta listo. Ya podes pasar a retirarlo.",
  ENTREGADO: "Equipo entregado. Gracias por confiar en nosotros.",
  ENTREGADO_RETIRO: "El equipo fue retirado sin reparacion.",
  CANCELADO: "La orden fue cancelada. Contactanos si tenes consultas.",
  SIN_REPARACION: "Lamentablemente no fue posible reparar el equipo.",
}

const estadoColors: Record<string, { text: string; bg: string; border: string }> = {
  RECIBIDO: { text: "text-slate-600 dark:text-slate-400", bg: "bg-slate-100 dark:bg-slate-900/40", border: "border-slate-200 dark:border-slate-800" },
  EN_DIAGNOSTICO: { text: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-950/40", border: "border-blue-200 dark:border-blue-800" },
  PRESUPUESTADO: { text: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/40", border: "border-amber-200 dark:border-amber-800" },
  APROBADO: { text: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/40", border: "border-emerald-200 dark:border-emerald-800" },
  EN_REPARACION: { text: "text-orange-600 dark:text-orange-400", bg: "bg-orange-50 dark:bg-orange-950/40", border: "border-orange-200 dark:border-orange-800" },
  ESPERANDO_REPUESTO: { text: "text-purple-600 dark:text-purple-400", bg: "bg-purple-50 dark:bg-purple-950/40", border: "border-purple-200 dark:border-purple-800" },
  REPARADO: { text: "text-green-600 dark:text-green-400", bg: "bg-green-50 dark:bg-green-950/40", border: "border-green-300 dark:border-green-800" },
  ENTREGADO: { text: "text-green-700 dark:text-green-400", bg: "bg-green-50 dark:bg-green-950/40", border: "border-green-200 dark:border-green-800" },
  CANCELADO: { text: "text-red-600 dark:text-red-400", bg: "bg-red-50 dark:bg-red-950/40", border: "border-red-200 dark:border-red-800" },
  SIN_REPARACION: { text: "text-red-600 dark:text-red-400", bg: "bg-red-50 dark:bg-red-950/40", border: "border-red-200 dark:border-red-800" },
}

const estadoIcons: Record<string, typeof Smartphone> = {
  RECIBIDO: Package,
  EN_DIAGNOSTICO: Search,
  PRESUPUESTADO: ClipboardCheck,
  APROBADO: ThumbsUp,
  EN_REPARACION: Settings,
  ESPERANDO_REPUESTO: Clock,
  REPARADO: CheckCircle2,
  ENTREGADO: Truck,
}

const estadoFlow = [
  "RECIBIDO",
  "EN_DIAGNOSTICO",
  "PRESUPUESTADO",
  "APROBADO",
  "EN_REPARACION",
  "REPARADO",
  "ENTREGADO",
]

const estadoShortLabels: Record<string, string> = {
  RECIBIDO: "Recibido",
  EN_DIAGNOSTICO: "Diagnostico",
  PRESUPUESTADO: "Presupuesto",
  APROBADO: "Aprobado",
  EN_REPARACION: "Reparando",
  REPARADO: "Listo",
  ENTREGADO: "Entregado",
}

// Mapa de íconos por código de tipo. Para tipos no listados se usa Package como fallback.
const tipoDispositivoIcons: Record<string, typeof Smartphone> = {
  // Electrónica de consumo
  CELULAR: Smartphone,
  COMPUTADORA: Monitor,
  TABLET: Tablet,
  CONSOLA: Gamepad2,
  SMARTWATCH: Watch,
  NOTEBOOK: Monitor,
  LAPTOP: Monitor,
  PC: Monitor,
  // Periféricos
  IMPRESORA: Printer,
  SCANNER: ScanLine,
  PROYECTOR: Projector,
  // Audio / Video
  TELEVISION: Tv,
  TV: Tv,
  CAMARA: Camera,
  AUDIFONOS: Headphones,
  AURICULARES: Headphones,
  // Redes / Almacenamiento
  ROUTER: Router,
  DISCO_DURO: HardDrive,
  SERVIDOR: Cpu,
  // Electrodomésticos
  HELADERA: Refrigerator,
  FREEZER: Snowflake,
  MICROONDAS: Microwave,
  LAVARROPAS: WashingMachine,
  LAVAVAJILLAS: WashingMachine,
  SECARROPAS: Wind,
  AIRE_ACONDICIONADO: AirVent,
  VENTILADOR: Fan,
  ELECTRODOMESTICO: Plug,
  HORNO: Zap,
  COCINA: Zap,
  CALEFACTOR: Zap,
}

interface TrackingData {
  id: string
  numeroOrden: number
  codigoOrden?: string
  dispositivo: string
  tipoDispositivo: string
  tipoDispositivoNombre?: string
  marca?: string
  color?: string
  estado: string
  problemaReportado: string
  accesorios?: string
  fechaIngreso: string
  fechaPrometida?: string
  fechaCompletado?: string
  fechaEntrega?: string
  publicToken?: string
  zonaHoraria?: string
  presupuesto?: number
  moneda?: string
  presupuestoAprobadoPortal?: boolean
  esRetiroSinReparacion?: boolean
  cotizaciones?: {
    id: string
    numeroCotizacion: string
    estado: string
    fechaVencimiento: string | null
    notas: string | null
    subtotal: number
    iva: number
    total: number
    createdAt: string
    publicToken: string
    firmaAprobacion: string | null
    firmaMime: string | null
    fechaAprobacion: string | null
    descuentoGlobalTipo?: string | null
    descuentoGlobalValor?: number | null
    ivaPorcentaje?: number | null
    terminos?: string | null
    items: {
      id: string
      descripcion: string
      cantidad: number
      precioUnitario: number
      subtotal: number
      unidad?: string
      descuentoTipo?: string
      descuentoValor?: number
    }[]
  }[]
  cliente: { nombre: string }
  organizacion: {
    nombre: string
    telefono?: string
    direccion?: string
    logoUrl?: string
  }
}

function getTimeRemaining(fechaPrometida: string): { text: string; urgency: "normal" | "soon" | "overdue" } | null {
  const now = new Date()
  const target = new Date(fechaPrometida)
  const diffMs = target.getTime() - now.getTime()
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays < 0) return { text: `${Math.abs(diffDays)} dia${Math.abs(diffDays) !== 1 ? "s" : ""} de atraso`, urgency: "overdue" }
  if (diffDays === 0) return { text: "Hoy", urgency: "soon" }
  if (diffDays === 1) return { text: "Manana", urgency: "soon" }
  if (diffDays <= 3) return { text: `${diffDays} dias`, urgency: "soon" }
  return { text: `${diffDays} dias`, urgency: "normal" }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function SeguimientoContent({ token }: { token: string }) {
  const [data, setData] = useState<TrackingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const [timelineEvents, setTimelineEvents] = useState<any[] | null>(null)
  const [photosData, setPhotosData] = useState<any | null>(null)
  const [warrantyData, setWarrantyData] = useState<any | null>(null)

  const formatDate = (dateStr: string | null | undefined) =>
    formatDateValue(dateStr, data?.zonaHoraria)

  const fetchEnhancedData = useCallback((t: string) => {
    fetch(`/api/public/ordenes/${t}/timeline`)
      .then((res) => res.ok ? res.json() : null)
      .then((d) => { if (d) setTimelineEvents(d) })
      .catch(() => {})

    fetch(`/api/public/ordenes/${t}/photos`)
      .then((res) => res.ok ? res.json() : null)
      .then((d) => { if (d) setPhotosData(d) })
      .catch(() => {})

    fetch(`/api/public/ordenes/${t}/warranty`)
      .then((res) => res.ok ? res.json() : null)
      .then((d) => { if (d && d.garantia) setWarrantyData(d.garantia) })
      .catch(() => {})
  }, [])

  const fetchData = useCallback(() => {
    const controller = new AbortController()
    fetch(`/api/public/ordenes/${token}`, { signal: controller.signal, cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error("Not found")
        return res.json()
      })
      .then((d) => {
        setData(d)
        fetchEnhancedData(token)
      })
      .catch(() => { if (!controller.signal.aborted) setError(true) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return controller
  }, [token, fetchEnhancedData])

  useEffect(() => {
    const controller = fetchData()
    return () => { controller.abort() }
  }, [fetchData])

  // Realtime: suscribirse a cambios de la orden cuando tenemos el id
  const channelRef = useRef<RealtimeChannel | null>(null)
  useEffect(() => {
    if (!data?.id) return

    const supabase = getSupabaseClient()
    const channel = supabase
      .channel(`seguimiento-${data.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ordenes_servicio", filter: `id=eq.${data.id}` },
        () => { fetchData() }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cotizaciones", filter: `orden_id=eq.${data.id}` },
        () => { fetchData() }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orden_eventos", filter: `orden_id=eq.${data.id}` },
        () => { fetchData() }
      )
      .subscribe()

    channelRef.current = channel
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [data?.id, fetchData])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="relative">
          <div className="h-16 w-16 rounded-full border-4 border-muted" />
          <Loader2 className="h-16 w-16 animate-spin text-primary absolute inset-0" />
        </div>
        <p className="text-muted-foreground font-medium">Cargando tu orden...</p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="text-center py-20">
        <div className="inline-flex items-center justify-center h-20 w-20 rounded-full bg-muted mb-6">
          <AlertCircle className="h-10 w-10 text-muted-foreground" />
        </div>
        <h2 className="text-2xl font-bold">Orden no encontrada</h2>
        <p className="text-muted-foreground mt-2 max-w-sm mx-auto">
          El enlace de seguimiento no es valido o la orden ya no existe.
        </p>
      </div>
    )
  }

  const DeviceIcon = tipoDispositivoIcons[data.tipoDispositivo] || Package
  const isRetiro = data.esRetiroSinReparacion === true
  const isTerminal = data.estado === "CANCELADO" || data.estado === "SIN_REPARACION"
  const isCompleted = data.estado === "ENTREGADO"
  const isReady = data.estado === "REPARADO"
  const estadoParaProgreso = data.estado === "ESPERANDO_REPUESTO" ? "EN_REPARACION" : data.estado
  const currentIndex = estadoFlow.indexOf(estadoParaProgreso)
  const progressPercent = isTerminal ? 0 : isCompleted ? 100 : Math.round(((currentIndex) / (estadoFlow.length - 1)) * 100)
  const activeCotizacion = data.cotizaciones?.find(c => c.estado === "ENVIADA")
  const showCotizacionApproval = data.estado === "PRESUPUESTADO" && !!activeCotizacion && !data.presupuestoAprobadoPortal
  const showBudgetApproval = data.estado === "PRESUPUESTADO" && data.presupuesto && !data.presupuestoAprobadoPortal && !activeCotizacion
  const CurrentStateIcon = estadoIcons[data.estado] || Circle
  const colors = estadoColors[data.estado] || estadoColors.RECIBIDO

  const timeRemaining = data.fechaPrometida && !isCompleted && !isTerminal && !isReady
    ? getTimeRemaining(data.fechaPrometida)
    : null

  const whatsappUrl = data.organizacion.telefono
    ? `https://wa.me/${data.organizacion.telefono.replace(/\D/g, "")}?text=${encodeURIComponent(
        `Hola, consulto por la orden ${data.codigoOrden || `#${data.numeroOrden}`} (${data.dispositivo})`
      )}`
    : null

  return (
    <div className="space-y-4">
      {/* ══════════ HERO HEADER ══════════ */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/90 via-primary to-primary/80 p-6 text-primary-foreground shadow-lg">
        <div className="absolute inset-0 opacity-[0.07]">
          <div className="absolute -right-6 -top-6 h-36 w-36 rounded-full bg-white" />
          <div className="absolute -left-4 -bottom-4 h-24 w-24 rounded-full bg-white" />
          <div className="absolute right-1/3 top-1/2 h-16 w-16 rounded-full bg-white" />
        </div>

        <div className="relative">
          <div className="flex items-center gap-3 mb-5">
            {data.organizacion.logoUrl ? (
              <Image
                src={data.organizacion.logoUrl}
                alt={data.organizacion.nombre}
                width={48}
                height={48}
                className="h-11 w-11 rounded-xl bg-white/20 backdrop-blur-sm p-1 object-contain"
                unoptimized
              />
            ) : (
              <div className="h-11 w-11 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center">
                <Wrench className="h-5 w-5" />
              </div>
            )}
            <div>
              <h1 className="text-base font-bold leading-tight">
                {data.organizacion.nombre || "Servicio Tecnico"}
              </h1>
              <p className="text-[11px] text-primary-foreground/60">Seguimiento de orden</p>
            </div>
          </div>

          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[11px] text-primary-foreground/60 uppercase tracking-wider font-medium mb-1">
                Orden
              </p>
              <p className="text-3xl font-extrabold tracking-tight leading-none">
                {data.codigoOrden || `#${data.numeroOrden}`}
              </p>
            </div>
            <div className="text-right shrink-0">
              <div className="inline-flex items-center gap-1.5 bg-white/15 backdrop-blur-sm rounded-lg px-3 py-2 text-sm font-medium">
                <DeviceIcon className="h-4 w-4 shrink-0" />
                <span className="truncate max-w-[140px]">{data.dispositivo}</span>
              </div>
              {data.marca && (
                <p className="text-[11px] text-primary-foreground/50 mt-1">{data.marca}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ══════════ GREETING ══════════ */}
      {data.cliente?.nombre && (
        <p className="text-sm text-muted-foreground px-1">
          Hola <span className="font-semibold text-foreground">{data.cliente.nombre.split(" ")[0]}</span>, aca podes ver el estado de tu equipo.
        </p>
      )}

      {/* ══════════ STATUS CARD ══════════ */}
      {isRetiro ? (
        <Card className="border border-amber-200 dark:border-amber-800">
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              <div className="h-14 w-14 rounded-2xl bg-amber-50 dark:bg-amber-950/40 flex items-center justify-center shrink-0">
                <Package className="h-7 w-7 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="font-bold text-lg text-amber-700 dark:text-amber-400">
                  Retirado sin reparacion
                </p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {estadoDescriptions.ENTREGADO_RETIRO}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : isTerminal ? (
        <Card className={`border ${colors.border}`}>
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              <div className={`h-14 w-14 rounded-2xl ${colors.bg} flex items-center justify-center shrink-0`}>
                <XCircle className={`h-7 w-7 ${colors.text}`} />
              </div>
              <div>
                <p className={`font-bold text-lg ${colors.text}`}>
                  {estadoLabels[data.estado]}
                </p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {estadoDescriptions[data.estado]}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className={`border ${colors.border} ${isReady ? "shadow-lg shadow-green-100 dark:shadow-none" : ""}`}>
          <CardContent className="p-5">
            <div className="flex items-center gap-4 mb-4">
              <div className={`h-14 w-14 rounded-2xl ${colors.bg} flex items-center justify-center shrink-0 ${!isCompleted && !isReady ? "animate-pulse" : ""}`}>
                <CurrentStateIcon className={`h-7 w-7 ${colors.text}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className={`font-bold text-lg ${colors.text}`}>
                    {estadoLabels[data.estado]}
                  </p>
                  {isReady && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-400 text-[10px] font-bold rounded-full uppercase tracking-wider">
                      <Sparkles className="h-3 w-3" />
                      Listo
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {estadoDescriptions[data.estado]}
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-[11px] text-muted-foreground font-medium">
                <span>Progreso</span>
                <span>{progressPercent}%</span>
              </div>
              <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-1000 ease-out ${
                    isCompleted || isReady ? "bg-green-500" : "bg-primary"
                  }`}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            {timeRemaining && (
              <div className={`mt-3 flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${
                timeRemaining.urgency === "overdue"
                  ? "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400"
                  : timeRemaining.urgency === "soon"
                    ? "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400"
                    : "bg-muted text-muted-foreground"
              }`}>
                <Timer className="h-3.5 w-3.5 shrink-0" />
                <span>
                  Estimado: <strong>{timeRemaining.text}</strong>
                  {timeRemaining.urgency === "overdue" && " — Contactanos para mas info"}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ══════════ CTA: RETIRAR EQUIPO ══════════ */}
      {isReady && whatsappUrl && (
        <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="block">
          <Card className="border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/30 hover:bg-green-100 dark:hover:bg-green-950/50 transition-colors cursor-pointer">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-green-500 flex items-center justify-center shrink-0">
                    <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                    </svg>
                  </div>
                  <div>
                    <p className="font-semibold text-green-800 dark:text-green-300 text-sm">Coordinar retiro</p>
                    <p className="text-xs text-green-600 dark:text-green-500">Escribinos por WhatsApp</p>
                  </div>
                </div>
                <ArrowRight className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
            </CardContent>
          </Card>
        </a>
      )}

      {/* ══════════ STEPPER HORIZONTAL ══════════ */}
      {isRetiro ? (
        <Card>
          <CardContent className="px-2 sm:px-3 py-4">
            <div className="flex items-start justify-between">
              {[
                { key: "RECIBIDO", label: "Recibido", icon: Package },
                { key: "DIAGNOSTICO", label: "Diagnostico", icon: Search },
                { key: "SIN_REPARACION", label: "Sin reparacion", icon: XCircle },
                { key: "RETIRADO", label: "Retirado", icon: Truck },
              ].map((step, index, arr) => (
                <div key={step.key} className="flex flex-col items-center relative flex-1">
                  {index < arr.length - 1 && (
                    <div className="absolute top-[11px] left-[calc(50%+11px)] right-[calc(-50%+11px)] h-[2px] bg-amber-500" />
                  )}
                  <div className="relative z-10 flex items-center justify-center h-6 w-6 rounded-full bg-amber-500 text-white">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  </div>
                  <p className="mt-1 text-center leading-tight text-amber-600 dark:text-amber-400 text-[9px] sm:text-[10px] font-medium">
                    {step.label}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : !isTerminal ? (
        <Card>
          <CardContent className="px-2 sm:px-3 py-4">
            <div className="flex items-start justify-between">
              {estadoFlow.map((estado, index) => {
                const isPast = index < currentIndex
                const isCurrent = index === currentIndex
                const StepIcon = estadoIcons[estado] || Circle

                return (
                  <div key={estado} className="flex flex-col items-center relative flex-1">
                    {index < estadoFlow.length - 1 && (
                      <div
                        className={`absolute top-[11px] left-[calc(50%+11px)] right-[calc(-50%+11px)] h-[2px] transition-colors duration-500 ${
                          isPast ? "bg-green-500" : "bg-muted"
                        }`}
                      />
                    )}

                    <div className={`relative z-10 flex items-center justify-center h-6 w-6 rounded-full transition-all duration-300
                      ${isPast
                        ? "bg-green-500 text-white"
                        : isCurrent
                          ? "bg-primary text-primary-foreground ring-[3px] ring-primary/20 scale-110"
                          : "bg-muted text-muted-foreground/50"
                      }`}
                    >
                      {isPast ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <StepIcon className="h-3 w-3" />
                      )}
                    </div>

                    <p className={`mt-1 text-center leading-tight ${
                      isPast
                        ? "text-green-600 dark:text-green-400 text-[9px] sm:text-[10px] font-medium"
                        : isCurrent
                          ? "text-primary text-[9px] sm:text-[10px] font-bold"
                          : "text-muted-foreground/40 text-[9px] sm:text-[10px]"
                    }`}>
                      {estadoShortLabels[estado]}
                    </p>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ══════════ VISUAL TIMELINE ══════════ */}
      {timelineEvents && timelineEvents.length > 0 && (
        <VisualTimeline events={timelineEvents} timezone={data.zonaHoraria} />
      )}

      {/* ══════════ COTIZACION / BUDGET APPROVAL ══════════ */}
      {showCotizacionApproval && activeCotizacion && (
        <CotizacionApproval
          token={token}
          cotizacion={activeCotizacion}
          dispositivo={data.dispositivo}
          moneda={data.moneda}
          zonaHoraria={data.zonaHoraria}
          onApproved={() => { fetchData() }}
        />
      )}
      {showBudgetApproval && (
        <BudgetApproval
          token={token}
          presupuesto={data.presupuesto!}
          moneda={data.moneda}
          dispositivo={data.dispositivo}
          onApproved={() => { fetchData() }}
        />
      )}

      {/* ══════════ PHOTOS ══════════ */}
      {photosData && (
        <PhotoGallery photos={photosData} />
      )}

      {/* ══════════ DEVICE + DATES ══════════ */}
      <Card>
        <CardContent className="p-0 divide-y">
          <div className="p-4">
            <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">
              <DeviceIcon className="h-3.5 w-3.5" />
              Equipo
            </div>
            <div>
              <p className="font-bold text-base">{data.dispositivo}</p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <Tag>{data.tipoDispositivoNombre || data.tipoDispositivo}</Tag>
                {data.marca && <Tag>{data.marca}</Tag>}
                {data.color && <Tag>{data.color}</Tag>}
              </div>
            </div>
          </div>

          <div className="px-4 py-3">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">Problema reportado</p>
            <p className="text-sm leading-relaxed">{data.problemaReportado}</p>
          </div>

          {data.accesorios && (
            <div className="px-4 py-3">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">Accesorios recibidos</p>
              <p className="text-sm">{data.accesorios}</p>
            </div>
          )}

          <div className="px-4 py-3">
            <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">
              <Calendar className="h-3.5 w-3.5" />
              Fechas
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <DateItem label="Ingreso" value={formatDate(data.fechaIngreso)} />
              {data.fechaPrometida && (
                <DateItem label="Estimada" value={formatDate(data.fechaPrometida)} urgency={timeRemaining?.urgency} />
              )}
              {data.fechaCompletado && <DateItem label="Completado" value={formatDate(data.fechaCompletado)} highlight />}
              {data.fechaEntrega && <DateItem label={isRetiro ? "Retirado" : "Entregado"} value={formatDate(data.fechaEntrega)} highlight />}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ══════════ WARRANTY ══════════ */}
      {warrantyData && !isRetiro && (data.estado === "REPARADO" || data.estado === "ENTREGADO") && (
        <WarrantyInfo garantia={warrantyData} />
      )}

      {/* ══════════ CONTACT + ACTIONS ══════════ */}
      <Card>
        <CardContent className="p-4 space-y-3">
          {(data.organizacion.telefono || data.organizacion.direccion) && (
            <div className="space-y-2">
              {data.organizacion.telefono && (
                <a
                  href={`tel:${data.organizacion.telefono}`}
                  className="flex items-center gap-2.5 text-sm font-medium text-primary hover:underline"
                >
                  <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Phone className="h-4 w-4 text-primary" />
                  </div>
                  {data.organizacion.telefono}
                </a>
              )}
              {data.organizacion.direccion && (
                <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                  <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <MapPin className="h-4 w-4" />
                  </div>
                  <span className="line-clamp-2">{data.organizacion.direccion}</span>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 pt-1">
            {whatsappUrl && (
              <Button variant="outline" size="sm" className="h-12 flex-col gap-1 items-center justify-center text-center text-green-600 border-green-200 hover:bg-green-50 hover:text-green-700 hover:border-green-300" asChild>
                <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="flex flex-col items-center justify-center text-center">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                  <span className="text-xs font-medium">WhatsApp</span>
                </a>
              </Button>
            )}
            {data.publicToken && (
              <Button variant="outline" size="sm" className="h-12 flex-col gap-1 items-center justify-center text-center" asChild>
                <a href={`/api/public/ordenes/${data.publicToken}/pdf`} target="_blank" rel="noopener noreferrer" className="flex flex-col items-center justify-center text-center">
                  <Download className="h-5 w-5" />
                  <span className="text-xs font-medium">Comprobante</span>
                </a>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <p className="text-center text-[10px] text-muted-foreground/50 pb-6 pt-2">
        Powered by STApp
      </p>
    </div>
  )
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-2 py-0.5 bg-muted rounded-md text-[11px] font-medium text-muted-foreground">
      {children}
    </span>
  )
}

function DateItem({ label, value, highlight, urgency }: {
  label: string
  value: string
  highlight?: boolean
  urgency?: "normal" | "soon" | "overdue"
}) {
  const isOverdue = urgency === "overdue"
  const isSoon = urgency === "soon"

  return (
    <div className={`px-3 py-2 rounded-lg ${
      highlight
        ? "bg-green-50 dark:bg-green-950/30"
        : isOverdue
          ? "bg-red-50 dark:bg-red-950/30"
          : isSoon
            ? "bg-amber-50 dark:bg-amber-950/30"
            : "bg-muted/50"
    }`}>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{label}</p>
      <p className={`text-sm font-semibold mt-0.5 ${
        highlight
          ? "text-green-700 dark:text-green-400"
          : isOverdue
            ? "text-red-700 dark:text-red-400"
            : isSoon
              ? "text-amber-700 dark:text-amber-400"
              : ""
      }`}>{value}</p>
    </div>
  )
}
