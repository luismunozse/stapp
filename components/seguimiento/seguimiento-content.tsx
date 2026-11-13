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
  Settings,
  Truck,
  Download,
  Timer,
  ArrowRight,
  Sparkles,
  WifiOff,
  RefreshCw,
} from "lucide-react"
import type { TimelineEvent } from "./visual-timeline"
import { EstadoFisico, type EstadoFisicoData } from "./estado-fisico"
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon"
import { ESTADO_ORDEN_UI, getEstadoOrdenUi } from "@/lib/estado-orden-ui"
import { STATUS_TONE_CLASSES } from "@/components/ui/status-pill"
import { useVisibilityPolling } from "@/hooks/use-visibility-polling"
import { resolveTerminologia, t, type Terminologia } from "@/lib/terminologia"
import {
  classifyEstado,
  shouldShowTimeRemaining,
  getTimeRemaining as computeTimeRemaining,
  getRetiroStepper,
  getRetiroLabel,
  ESTADO_FLOW,
} from "@/lib/seguimiento-state"
import { ShieldCheck, ThumbsDown } from "lucide-react"

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

/** Respuesta no-OK de /api/public/ordenes/[token], con su status HTTP. */
class FetchError extends Error {
  status: number
  constructor(status: number) {
    super(`HTTP ${status}`)
    this.status = status
  }
}

// Respuestas definitivas de getOrderByPublicToken: token inválido (400),
// orden inexistente (404) o enlace vencido (410). Reintentar no cambia nada.
const NOT_FOUND_STATUSES = new Set([400, 404, 410])

function TimelineSkeleton() {
  return (
    <div className="py-4 text-center text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin mx-auto" />
    </div>
  )
}

function buildEstadoDescriptions(term: (key: string) => string): Record<string, string> {
  const equipo = term("equipo")
  const tecnico = term("tecnico")
  const reparacion = term("reparacion")
  return {
    RECIBIDO: `Tu ${equipo} fue recibido en el taller. Pronto comenzaremos a revisarlo.`,
    EN_DIAGNOSTICO: `Un ${tecnico} está evaluando tu ${equipo} para determinar la falla.`,
    PRESUPUESTADO: `Ya tenemos el presupuesto de la ${reparacion}. Esperamos tu aprobación.`,
    APROBADO: `Presupuesto aprobado. Tu ${equipo} entrará en ${reparacion} a la brevedad.`,
    EN_REPARACION: `Nuestro ${tecnico} está trabajando en tu ${equipo}.`,
    ESPERANDO_REPUESTO: "Estamos esperando la llegada de un repuesto necesario.",
    REPARADO: `Tu ${equipo} está listo. Ya podés pasar a retirarlo.`,
    ENTREGADO: `${equipo} entregado. ¡Gracias por confiar en nosotros!`,
    ENTREGADO_SIN_REPARACION: `El ${equipo} fue retirado sin ${reparacion}.`,
    ENTREGADO_SIN_COBRO: `El ${equipo} fue retirado sin cobro.`,
    CANCELADO: "La orden fue cancelada. Contactanos si tenés consultas.",
    SIN_REPARACION: `Lamentablemente no fue posible reparar el ${equipo}.`,
    SIN_FALLA_DETECTADA: `Revisamos tu ${equipo} y no detectamos la falla reportada. Ya podés pasar a retirarlo.`,
  }
}

const estadoFlow = ESTADO_FLOW

const estadoShortLabels: Record<string, string> = {
  RECIBIDO: "Recibido",
  EN_DIAGNOSTICO: "Diagnóstico",
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
  motivoSinCobro?: string | null
  problemaReportado: string
  diagnostico?: string | null
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
    motivoRechazo?: string | null
    fechaRechazo?: string | null
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
  whatsappMensajeConsulta?: string
  recepcionTerminos?: string[]
  terminologia?: Terminologia
}


export function SeguimientoContent({ token }: { token: string }) {
  const [data, setData] = useState<TrackingData | null>(null)
  const [loading, setLoading] = useState(true)
  // Error de la carga inicial (sin datos todavía): "not_found" es definitivo
  // (token inválido, orden inexistente o enlace vencido); "network" es un
  // fallo de red/servidor y se ofrece reintentar.
  const [loadError, setLoadError] = useState<"not_found" | "network" | null>(null)
  // Un poll falló pero ya hay datos: se siguen mostrando con un aviso discreto.
  const [pollFailed, setPollFailed] = useState(false)
  const hasDataRef = useRef(false)
  // Estado para el que ya se pidieron timeline/fotos/garantía. Las fotos salen
  // con URL firmada nueva en cada pedido: refetchearlas en cada poll hace que
  // el navegador vuelva a descargar todas las imágenes cada 15 s.
  const enhancedEstadoRef = useRef<string | null>(null)

  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[] | null>(null)
  const [photosData, setPhotosData] = useState<any | null>(null)
  const [warrantyData, setWarrantyData] = useState<any | null>(null)
  const [danosData, setDanosData] = useState<EstadoFisicoData | null>(null)

  const formatDate = (dateStr: string | null | undefined) =>
    formatDateValue(dateStr, data?.zonaHoraria)

  const fetchEnhancedData = useCallback((t: string) => {
    fetch(`/api/public/ordenes/${t}/timeline`)
      .then((res) => res.ok ? res.json() : null)
      .then((d) => { if (d && Array.isArray(d.timeline)) setTimelineEvents(d.timeline) })
      .catch(() => {})

    fetch(`/api/public/ordenes/${t}/photos`)
      .then((res) => res.ok ? res.json() : null)
      .then((d) => { if (d) setPhotosData(d) })
      .catch(() => {})

    // Si falla, la sección simplemente no se muestra.
    fetch(`/api/public/ordenes/${t}/danos`)
      .then((res) => res.ok ? res.json() : null)
      .then((d) => { if (d && Array.isArray(d.danos)) setDanosData(d) })
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
        if (!res.ok) throw new FetchError(res.status)
        return res.json()
      })
      .then((d: TrackingData) => {
        hasDataRef.current = true
        setData(d)
        setLoadError(null)
        setPollFailed(false)
        if (enhancedEstadoRef.current !== d.estado) {
          enhancedEstadoRef.current = d.estado
          fetchEnhancedData(token)
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        if (hasDataRef.current) {
          // Fallo de un poll: no se tira abajo lo que el cliente ya está viendo.
          setPollFailed(true)
          return
        }
        const status = err instanceof FetchError ? err.status : null
        setLoadError(status !== null && NOT_FOUND_STATUSES.has(status) ? "not_found" : "network")
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return controller
  }, [token, fetchEnhancedData])

  const retry = useCallback(() => {
    setLoadError(null)
    setLoading(true)
    fetchData()
  }, [fetchData])

  useEffect(() => {
    const controller = fetchData()
    return () => { controller.abort() }
  }, [fetchData])

  // Visibility-aware polling: refetch every 15s while the order is loaded,
  // pausing automatically when the tab is hidden. Zero anon Supabase DB access.
  useVisibilityPolling(fetchData, 15000, Boolean(data?.id))

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

  if (!data && loadError === "network") {
    return (
      <div className="text-center py-20">
        <div className="inline-flex items-center justify-center h-20 w-20 rounded-full bg-muted mb-6">
          <WifiOff className="h-10 w-10 text-muted-foreground" />
        </div>
        <h2 className="text-2xl font-bold">No pudimos cargar tu orden</h2>
        <p className="text-muted-foreground mt-2 max-w-sm mx-auto">
          Revisá tu conexión e intentá de nuevo en unos segundos.
        </p>
        <Button className="mt-6" onClick={retry}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Reintentar
        </Button>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="text-center py-20">
        <div className="inline-flex items-center justify-center h-20 w-20 rounded-full bg-muted mb-6">
          <AlertCircle className="h-10 w-10 text-muted-foreground" />
        </div>
        <h2 className="text-2xl font-bold">Orden no encontrada</h2>
        <p className="text-muted-foreground mt-2 max-w-sm mx-auto">
          El enlace de seguimiento no es válido o la orden ya no existe.
        </p>
      </div>
    )
  }

  const term = (key: string) => t(resolveTerminologia(data.terminologia), key)
  const estadoDescriptions = buildEstadoDescriptions(term)

  const DeviceIcon = tipoDispositivoIcons[data.tipoDispositivo] || Package
  const estadoClass = classifyEstado(data.estado)
  const { isRetiro, isTerminal, isCompleted, isReady, currentIndex, progressPercent } = estadoClass
  const activeCotizacion = data.cotizaciones?.find(c => c.estado === "ENVIADA")
  const rejectedCotizacion = !activeCotizacion
    ? data.cotizaciones?.find(c => c.estado === "RECHAZADA")
    : undefined
  const showCotizacionApproval = data.estado === "PRESUPUESTADO" && !!activeCotizacion && !data.presupuestoAprobadoPortal
  const showBudgetApproval = data.estado === "PRESUPUESTADO" && data.presupuesto && !data.presupuestoAprobadoPortal && !activeCotizacion
  const estadoUi = getEstadoOrdenUi(data.estado)
  const CurrentStateIcon = estadoUi.icon
  const colors = STATUS_TONE_CLASSES[estadoUi.tone]

  const timeRemaining = shouldShowTimeRemaining(estadoClass)
    ? computeTimeRemaining(data.fechaPrometida, new Date(), data.zonaHoraria)
    : null

  const whatsappUrl = data.organizacion.telefono
    ? `https://wa.me/${data.organizacion.telefono.replace(/\D/g, "")}?text=${encodeURIComponent(
        data.whatsappMensajeConsulta ||
          `Hola, consulto por la orden ${data.codigoOrden || `#${data.numeroOrden}`} (${data.dispositivo})`
      )}`
    : null

  return (
    <div className="space-y-4">
      {pollFailed && (
        <p
          role="status"
          className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground"
        >
          <WifiOff className="h-3.5 w-3.5" />
          Sin conexión, reintentando…
        </p>
      )}

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
                {data.organizacion.nombre || "Servicio Técnico"}
              </h1>
              <p className="text-xs text-primary-foreground/60">Seguimiento de orden</p>
            </div>
          </div>

          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs text-primary-foreground/60 uppercase tracking-wider font-medium mb-1">
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
                <p className="text-xs text-primary-foreground/50 mt-1">{data.marca}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ══════════ GREETING ══════════ */}
      {data.cliente?.nombre && (
        <p className="text-sm text-muted-foreground px-1">
          Hola <span className="font-semibold text-foreground">{data.cliente.nombre.split(" ")[0]}</span>, acá podés ver el estado de tu {term("equipo")}.
        </p>
      )}

      {/* ══════════ STATUS CARD ══════════ */}
      {isRetiro ? (
        <Card className={`border ${colors.border}`}>
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              <div className={`h-14 w-14 rounded-2xl ${colors.bg} flex items-center justify-center shrink-0`}>
                <CurrentStateIcon className={`h-7 w-7 ${colors.text}`} />
              </div>
              <div>
                <p className={`font-bold text-lg ${colors.text}`}>
                  {data.estado === "ENTREGADO_SIN_COBRO"
                    ? getRetiroLabel(data.motivoSinCobro).title
                    : estadoUi.labelCliente}
                </p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {data.estado === "ENTREGADO_SIN_COBRO"
                    ? getRetiroLabel(data.motivoSinCobro).description
                    : estadoDescriptions[data.estado] || estadoDescriptions.ENTREGADO_SIN_REPARACION}
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
                <CurrentStateIcon className={`h-7 w-7 ${colors.text}`} />
              </div>
              <div>
                <p className={`font-bold text-lg ${colors.text}`}>
                  {estadoUi.labelCliente}
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
                    {estadoUi.labelCliente}
                  </p>
                  {isReady && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-400 text-xs font-bold rounded-full uppercase tracking-wider">
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
              <div className="flex justify-between text-xs text-muted-foreground font-medium">
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
                  {timeRemaining.urgency === "overdue" && " — Contactanos para más info"}
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
                    <WhatsAppIcon className="h-5 w-5 text-white" />
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
              {(() => {
                const stepperIconMap: Record<string, typeof Package> = {
                  Package,
                  Search,
                  ClipboardCheck,
                  Settings,
                  CheckCircle2,
                  XCircle,
                  ThumbsDown,
                  ShieldCheck,
                  Truck,
                }
                // Si es ENTREGADO_SIN_COBRO usamos el camino según motivo,
                // sino fallback al camino legacy "sin reparación".
                const steps = data.estado === "ENTREGADO_SIN_COBRO"
                  ? getRetiroStepper(data.motivoSinCobro)
                  : getRetiroStepper("NO_REPARABLE")
                return steps.map((step, index, arr) => {
                  const StepIcon = stepperIconMap[step.icon] || CheckCircle2
                  return (
                    <div key={step.key} className="flex flex-col items-center relative flex-1 min-w-0">
                      {index < arr.length - 1 && (
                        <div className="absolute top-[11px] left-[calc(50%+11px)] right-[calc(-50%+11px)] h-[2px] bg-amber-500" />
                      )}
                      <div className="relative z-10 flex items-center justify-center h-6 w-6 rounded-full bg-amber-500 text-white">
                        <StepIcon className="h-3.5 w-3.5" />
                      </div>
                      <p className="mt-1 w-full text-center leading-tight break-words hyphens-auto text-amber-700 dark:text-amber-400 text-xs font-medium">
                        {step.label}
                      </p>
                    </div>
                  )
                })
              })()}
            </div>
          </CardContent>
        </Card>
      ) : !isTerminal ? (
        <Card>
          <CardContent className="px-2 sm:px-3 py-4">
            <div className="flex items-start justify-between">
              {estadoFlow.map((estado, index) => {
                // Si la orden está completada, todos los pasos cuentan como past
                const isPast = isCompleted ? true : index < currentIndex
                const isCurrent = !isCompleted && index === currentIndex
                const StepIcon = ESTADO_ORDEN_UI[estado].icon

                return (
                  <div key={estado} className="flex flex-col items-center relative flex-1 min-w-0">
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

                    <p className={`mt-1 w-full text-center leading-tight break-words hyphens-auto ${
                      isPast
                        ? "text-green-600 dark:text-green-400 text-xs font-medium"
                        : isCurrent
                          ? "text-primary text-xs font-bold"
                          : "text-muted-foreground/40 text-xs"
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

      {/* ══════════ DIAGNOSTICO DEL TECNICO ══════════ */}
      {data.diagnostico && (
        <Card className="border-blue-200 dark:border-blue-800">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center shrink-0">
                <Search className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-widest mb-1">
                  Diagnóstico del {term("tecnico")}
                </p>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{data.diagnostico}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ══════════ COTIZACION / BUDGET APPROVAL ══════════ */}
      {showCotizacionApproval && activeCotizacion && (
        <CotizacionApproval
          token={token}
          cotizacion={activeCotizacion}
          dispositivo={data.dispositivo}
          moneda={data.moneda}
          zonaHoraria={data.zonaHoraria}
          diagnostico={data.diagnostico || undefined}
          onApproved={() => { fetchData() }}
        />
      )}
      {showBudgetApproval && (
        <BudgetApproval
          token={token}
          presupuesto={data.presupuesto!}
          moneda={data.moneda}
          dispositivo={data.dispositivo}
          diagnostico={data.diagnostico || undefined}
          onApproved={() => { fetchData() }}
        />
      )}

      {/* ══════════ COTIZACION RECHAZADA ══════════ */}
      {rejectedCotizacion && !showCotizacionApproval && !showBudgetApproval && (
        <Card className="border-red-200 dark:border-red-800">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-red-50 dark:bg-red-950/40 flex items-center justify-center shrink-0">
                <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <div className="flex-1 min-w-0 space-y-2">
                <div>
                  <p className="text-xs font-bold text-red-600 dark:text-red-400 uppercase tracking-widest">
                    Presupuesto rechazado
                  </p>
                  <p className="text-sm font-semibold mt-0.5">
                    {rejectedCotizacion.numeroCotizacion}
                  </p>
                  {rejectedCotizacion.fechaRechazo && (
                    <p className="text-xs text-muted-foreground">
                      Rechazado el {formatDate(rejectedCotizacion.fechaRechazo)}
                    </p>
                  )}
                </div>

                {rejectedCotizacion.motivoRechazo && (
                  <div className="rounded-md bg-red-50/60 dark:bg-red-950/30 p-2 border border-red-100 dark:border-red-900">
                    <p className="text-xs font-medium text-red-700 dark:text-red-300 uppercase tracking-wider mb-0.5">
                      Motivo
                    </p>
                    <p className="text-sm whitespace-pre-wrap">{rejectedCotizacion.motivoRechazo}</p>
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  El taller fue notificado y puede contactarte para ofrecer alternativas.
                </p>

                {rejectedCotizacion.publicToken && (
                  <a
                    href={`/api/public/cotizaciones/${rejectedCotizacion.publicToken}/pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button variant="outline" size="sm" className="w-full">
                      <Download className="mr-2 h-4 w-4" />
                      Descargar PDF
                    </Button>
                  </a>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ══════════ PHOTOS ══════════ */}
      {photosData && (
        <PhotoGallery photos={photosData} />
      )}

      {/* ══════════ ESTADO FÍSICO ══════════ */}
      {danosData && <EstadoFisico data={danosData} />}

      {/* ══════════ DEVICE + DATES ══════════ */}
      <Card>
        <CardContent className="p-0 divide-y">
          <div className="p-4">
            <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3">
              <DeviceIcon className="h-3.5 w-3.5" />
              {term("equipo")}
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
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1.5">Problema reportado</p>
            <p className="text-sm leading-relaxed">{data.problemaReportado}</p>
          </div>

          {data.accesorios && (
            <div className="px-4 py-3">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1.5">Accesorios recibidos</p>
              <p className="text-sm">{data.accesorios}</p>
            </div>
          )}

          <div className="px-4 py-3">
            <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3">
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
      {/* La garantía nace al entregar: si existe se muestra, con el reclamo en curso si hay. */}
      {warrantyData && !isRetiro && <WarrantyInfo garantia={warrantyData} timezone={data.zonaHoraria} />}

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
                  <WhatsAppIcon className="h-5 w-5" />
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

      {data.recepcionTerminos && data.recepcionTerminos.length > 0 && (
        <Card>
          <CardContent className="p-4 sm:p-6">
            <p className="text-sm font-semibold mb-2">Términos y condiciones</p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {data.recepcionTerminos.map((termino, i) => (
                <li key={i} className="whitespace-pre-wrap">{termino}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <p className="text-center text-xs text-muted-foreground/50 pb-6 pt-2">
        Powered by STApp
      </p>
    </div>
  )
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-2 py-0.5 bg-muted rounded-md text-xs font-medium text-muted-foreground">
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
      <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">{label}</p>
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
