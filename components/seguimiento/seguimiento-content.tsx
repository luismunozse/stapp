"use client"

import { useState, useEffect, useCallback } from "react"
import dynamic from "next/dynamic"
import Image from "next/image"
import { formatDateValue } from "@/lib/timezone"
import { Card, CardContent } from "@/components/ui/card"
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
  CheckCircle2,
  Circle,
  Phone,
  MapPin,
  Wrench,
  FileText,
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
} from "lucide-react"

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
  REPARADO: "Reparado",
  ENTREGADO: "Entregado",
  CANCELADO: "Cancelado",
  SIN_REPARACION: "Sin reparacion",
}

const estadoDescriptions: Record<string, string> = {
  RECIBIDO: "Tu equipo fue recibido en el taller",
  EN_DIAGNOSTICO: "Un tecnico esta evaluando tu equipo",
  PRESUPUESTADO: "Ya tenemos el presupuesto de la reparacion",
  APROBADO: "Presupuesto aprobado, entrando a reparacion",
  EN_REPARACION: "Nuestro tecnico esta trabajando en tu equipo",
  ESPERANDO_REPUESTO: "Esperando la llegada de un repuesto",
  REPARADO: "Tu equipo esta listo para retirar",
  ENTREGADO: "Equipo entregado. Gracias por confiar en nosotros",
  CANCELADO: "La orden fue cancelada",
  SIN_REPARACION: "No fue posible reparar el equipo",
}

const estadoColors: Record<string, string> = {
  RECIBIDO: "text-slate-600",
  EN_DIAGNOSTICO: "text-blue-600",
  PRESUPUESTADO: "text-amber-600",
  APROBADO: "text-emerald-600",
  EN_REPARACION: "text-orange-600",
  ESPERANDO_REPUESTO: "text-purple-600",
  REPARADO: "text-green-600",
  ENTREGADO: "text-green-700",
  CANCELADO: "text-red-600",
  SIN_REPARACION: "text-red-600",
}

const estadoBgColors: Record<string, string> = {
  RECIBIDO: "bg-slate-100 dark:bg-slate-900/40",
  EN_DIAGNOSTICO: "bg-blue-50 dark:bg-blue-950/40",
  PRESUPUESTADO: "bg-amber-50 dark:bg-amber-950/40",
  APROBADO: "bg-emerald-50 dark:bg-emerald-950/40",
  EN_REPARACION: "bg-orange-50 dark:bg-orange-950/40",
  ESPERANDO_REPUESTO: "bg-purple-50 dark:bg-purple-950/40",
  REPARADO: "bg-green-50 dark:bg-green-950/40",
  ENTREGADO: "bg-green-50 dark:bg-green-950/40",
  CANCELADO: "bg-red-50 dark:bg-red-950/40",
  SIN_REPARACION: "bg-red-50 dark:bg-red-950/40",
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

const tipoDispositivoIcons: Record<string, typeof Smartphone> = {
  CELULAR: Smartphone,
  COMPUTADORA: Monitor,
  TABLET: Tablet,
  CONSOLA: Gamepad2,
  SMARTWATCH: Watch,
  IMPRESORA: Printer,
  TELEVISION: Tv,
  TV: Tv,
  CAMARA: Camera,
  AUDIFONOS: Headphones,
  AURICULARES: Headphones,
  ROUTER: Router,
  DISCO_DURO: HardDrive,
  SERVIDOR: Cpu,
  NOTEBOOK: Monitor,
  LAPTOP: Monitor,
  PC: Monitor,
}

const tipoDispositivoLabels: Record<string, string> = {
  CELULAR: "Celular",
  COMPUTADORA: "Computadora",
  TABLET: "Tablet",
  CONSOLA: "Consola",
  SMARTWATCH: "Smartwatch",
  IMPRESORA: "Impresora",
  TELEVISION: "Televisión",
  TV: "TV",
  CAMARA: "Cámara",
  AUDIFONOS: "Audífonos",
  AURICULARES: "Auriculares",
  ROUTER: "Router",
  DISCO_DURO: "Disco Duro",
  SERVIDOR: "Servidor",
  NOTEBOOK: "Notebook",
  LAPTOP: "Laptop",
  PC: "PC",
}

interface TrackingData {
  numeroOrden: number
  codigoOrden?: string
  dispositivo: string
  tipoDispositivo: string
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
  cliente: { nombre: string }
  organizacion: {
    nombre: string
    telefono?: string
    direccion?: string
    logoUrl?: string
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function SeguimientoContent({ token }: { token: string }) {
  const [data, setData] = useState<TrackingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  // Enhanced data
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
    const interval = setInterval(() => { fetchData() }, 30000)
    return () => { controller.abort(); clearInterval(interval) }
  }, [fetchData])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
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
      <div className="text-center py-16">
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
  const isTerminal = data.estado === "CANCELADO" || data.estado === "SIN_REPARACION"
  const isCompleted = data.estado === "ENTREGADO"
  const isReady = data.estado === "REPARADO"
  const currentIndex = estadoFlow.indexOf(data.estado)
  const progressPercent = isTerminal ? 0 : isCompleted ? 100 : Math.round(((currentIndex) / (estadoFlow.length - 1)) * 100)
  const showBudgetApproval = data.estado === "PRESUPUESTADO" && data.presupuesto && !data.presupuestoAprobadoPortal
  const CurrentStateIcon = estadoIcons[data.estado] || Circle

  return (
    <div className="space-y-4">
      {/* ══════════ HERO HEADER ══════════ */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/90 to-primary p-6 text-primary-foreground">
        {/* Background pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute -right-8 -top-8 h-40 w-40 rounded-full bg-white/20" />
          <div className="absolute -left-4 -bottom-4 h-24 w-24 rounded-full bg-white/10" />
        </div>

        <div className="relative">
          {/* Logo + org name */}
          <div className="flex items-center gap-3 mb-4">
            {data.organizacion.logoUrl ? (
              <Image
                src={data.organizacion.logoUrl}
                alt={data.organizacion.nombre}
                width={48}
                height={48}
                className="h-12 w-12 rounded-xl bg-white/20 p-1 object-contain"
                unoptimized
              />
            ) : (
              <div className="h-12 w-12 rounded-xl bg-white/20 flex items-center justify-center">
                <Wrench className="h-6 w-6" />
              </div>
            )}
            <div>
              <h1 className="text-lg font-bold leading-tight">
                {data.organizacion.nombre || "Servicio Tecnico"}
              </h1>
              <p className="text-xs text-primary-foreground/70">Seguimiento de orden</p>
            </div>
          </div>

          {/* Order number + device */}
          <div className="flex items-end justify-between">
            <div>
              <p className="text-sm text-primary-foreground/70 mb-0.5">
                Orden
              </p>
              <p className="text-2xl font-bold tracking-tight">
                {data.codigoOrden || `#${data.numeroOrden}`}
              </p>
            </div>
            <div className="text-right">
              <div className="inline-flex items-center gap-1.5 bg-white/20 backdrop-blur-sm rounded-lg px-3 py-1.5 text-sm font-medium">
                <DeviceIcon className="h-4 w-4" />
                {data.dispositivo}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ══════════ STATUS BANNER ══════════ */}
      {isTerminal ? (
        <Card className="border-red-200 dark:border-red-800">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-red-100 dark:bg-red-950/50 flex items-center justify-center shrink-0">
                <XCircle className="h-6 w-6 text-red-600" />
              </div>
              <div>
                <p className="font-semibold text-red-700 dark:text-red-400">
                  {estadoLabels[data.estado]}
                </p>
                <p className="text-sm text-muted-foreground">
                  {estadoDescriptions[data.estado]}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className={isReady ? "border-green-300 dark:border-green-800 shadow-green-100 dark:shadow-none shadow-md" : ""}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3 mb-4">
              <div className={`h-12 w-12 rounded-full flex items-center justify-center shrink-0 ${estadoBgColors[data.estado]}`}>
                <CurrentStateIcon className={`h-6 w-6 ${estadoColors[data.estado]} ${!isCompleted && !isReady ? "animate-pulse" : ""}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`font-semibold ${estadoColors[data.estado]}`}>
                  {estadoLabels[data.estado]}
                </p>
                <p className="text-sm text-muted-foreground">
                  {estadoDescriptions[data.estado]}
                </p>
              </div>
              {isReady && (
                <span className="shrink-0 px-3 py-1 bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-400 text-xs font-bold rounded-full animate-pulse">
                  LISTO
                </span>
              )}
            </div>

            {/* Progress bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Progreso</span>
                <span>{progressPercent}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ease-out ${
                    isCompleted
                      ? "bg-green-500"
                      : isReady
                        ? "bg-green-500"
                        : "bg-primary"
                  }`}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ══════════ STEPPER HORIZONTAL ══════════ */}
      {!isTerminal && (
        <Card>
          <CardContent className="px-3 py-4">
            <div className="flex items-start justify-between">
              {estadoFlow.map((estado, index) => {
                const isPast = index < currentIndex
                const isCurrent = index === currentIndex
                const StepIcon = estadoIcons[estado] || Circle

                return (
                  <div key={estado} className="flex flex-col items-center relative flex-1">
                    {/* Connecting line */}
                    {index < estadoFlow.length - 1 && (
                      <div
                        className={`absolute top-3 left-[calc(50%+10px)] right-[calc(-50%+10px)] h-0.5 ${
                          isPast ? "bg-green-500" : "bg-muted"
                        }`}
                      />
                    )}

                    {/* Step circle */}
                    <div className={`relative z-10 flex items-center justify-center h-6 w-6 rounded-full
                      ${isPast
                        ? "bg-green-500 text-white"
                        : isCurrent
                          ? "bg-primary text-primary-foreground ring-4 ring-primary/20"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {isPast ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : (
                        <StepIcon className="h-3 w-3" />
                      )}
                    </div>

                    {/* Label (only on md+) */}
                    <p className={`mt-1.5 text-center leading-tight hidden sm:block ${
                      isPast
                        ? "text-green-600 dark:text-green-400 text-[10px] font-medium"
                        : isCurrent
                          ? "text-primary text-[10px] font-bold"
                          : "text-muted-foreground/50 text-[10px]"
                    }`}>
                      {estadoLabels[estado]?.replace("En ", "").replace("reparacion", "repar.")}
                    </p>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ══════════ VISUAL TIMELINE (si existe) ══════════ */}
      {timelineEvents && timelineEvents.length > 0 && (
        <VisualTimeline events={timelineEvents} timezone={data.zonaHoraria} />
      )}

      {/* ══════════ BUDGET APPROVAL ══════════ */}
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

      {/* ══════════ DEVICE + DATES COMBINED ══════════ */}
      <Card>
        <CardContent className="p-0">
          {/* Device info header */}
          <div className="p-4 pb-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              <DeviceIcon className="h-3.5 w-3.5" />
              Equipo
            </div>
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-lg">{data.dispositivo}</p>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  <span className="px-2 py-0.5 bg-muted rounded-md text-xs font-medium">
                    {tipoDispositivoLabels[data.tipoDispositivo] || data.tipoDispositivo}
                  </span>
                  {data.marca && (
                    <span className="px-2 py-0.5 bg-muted rounded-md text-xs font-medium">{data.marca}</span>
                  )}
                  {data.color && (
                    <span className="px-2 py-0.5 bg-muted rounded-md text-xs font-medium">{data.color}</span>
                  )}
                </div>
              </div>
              {data.cliente?.nombre && (
                <p className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-md shrink-0">
                  {data.cliente.nombre}
                </p>
              )}
            </div>
          </div>

          {/* Problema reportado */}
          <div className="px-4 py-3 border-t bg-muted/30">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Problema reportado</p>
            <p className="text-sm">{data.problemaReportado}</p>
          </div>

          {/* Accesorios */}
          {data.accesorios && (
            <div className="px-4 py-3 border-t bg-muted/30">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Accesorios recibidos</p>
              <p className="text-sm">{data.accesorios}</p>
            </div>
          )}

          {/* Fechas */}
          <div className="px-4 py-3 border-t">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              <Calendar className="h-3.5 w-3.5" />
              Fechas
            </div>
            <div className="grid grid-cols-2 gap-3">
              <DateItem label="Ingreso" value={formatDate(data.fechaIngreso)} />
              {data.fechaPrometida && <DateItem label="Fecha estimada" value={formatDate(data.fechaPrometida)} />}
              {data.fechaCompletado && <DateItem label="Completado" value={formatDate(data.fechaCompletado)} highlight />}
              {data.fechaEntrega && <DateItem label="Entregado" value={formatDate(data.fechaEntrega)} highlight />}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ══════════ WARRANTY ══════════ */}
      {warrantyData && (data.estado === "REPARADO" || data.estado === "ENTREGADO") && (
        <WarrantyInfo garantia={warrantyData} />
      )}

      {/* ══════════ CONTACT + PDF ══════════ */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            {/* Contact info */}
            <div className="space-y-1.5">
              {data.organizacion.telefono && (
                <a
                  href={`tel:${data.organizacion.telefono}`}
                  className="flex items-center gap-2 text-sm text-primary hover:underline font-medium"
                >
                  <Phone className="h-4 w-4" />
                  {data.organizacion.telefono}
                </a>
              )}
              {data.organizacion.direccion && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4 shrink-0" />
                  <span className="line-clamp-1">{data.organizacion.direccion}</span>
                </div>
              )}
            </div>

            {/* PDF download button */}
            {data.publicToken && (
              <a
                href={`/api/public/ordenes/${data.publicToken}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-muted hover:bg-muted/80 text-sm font-medium transition-colors"
              >
                <Download className="h-4 w-4" />
                PDF
              </a>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Footer */}
      <p className="text-center text-[10px] text-muted-foreground/60 pb-4">
        Powered by STApp
      </p>
    </div>
  )
}

function DateItem({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`px-3 py-2 rounded-lg ${highlight ? "bg-green-50 dark:bg-green-950/30" : "bg-muted/50"}`}>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className={`text-sm font-medium mt-0.5 ${highlight ? "text-green-700 dark:text-green-400" : ""}`}>{value}</p>
    </div>
  )
}
