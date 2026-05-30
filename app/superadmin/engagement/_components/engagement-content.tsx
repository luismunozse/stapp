"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Activity,
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  Users,
  Heart,
  Mail,
  RefreshCw,
  Loader2,
  Search,
  ArrowUpDown,
  Megaphone,
  Clock,
  MessageSquare,
  ThumbsUp,
  ThumbsDown,
  Minus,
  ExternalLink,
  MoreHorizontal,
  Info,
  CheckCircle2,
  XCircle,
} from "lucide-react"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
  ReferenceArea,
} from "recharts"
import { useSuperadminFetch, useSuperadminMutation } from "@/hooks/use-superadmin-fetch"
import { toast } from "sonner"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OrgEngagement {
  id: string
  nombre: string
  slug: string
  plan: string
  subscriptionStatus: string
  trialEnd: string | null
  avgEngagement7d: number
  ordenes7d: number
  ventas7d: number
  ordenes30d: number
  ventas30d: number
  ultimaActividad: string | null
  usuariosActivos: number
  createdAt: string
  riesgo: "alto" | "medio" | "bajo"
}

interface TrendPoint {
  fecha: string
  avgScore: number
  totalOrdenes: number
  orgsActivas: number
}

interface EngagementData {
  summary: {
    totalActive: number
    highRisk: number
    mediumRisk: number
    avgEngagement: number
    churnRate: number
    churnedThisMonth: number
    lastCalculatedAt: string | null
  }
  organizations: OrgEngagement[]
  trend: TrendPoint[]
  emailStats: Record<string, { sent: number; failed: number }>
  churned: Array<{ organizationId: string; nombre: string; canceledAt: string }>
  trialsExpiredWithoutConversion: number
}

interface NpsData {
  allTime: { nps: number; promotores: number; pasivos: number; detractores: number; total: number }
  last30Days: { nps: number; promotores: number; pasivos: number; detractores: number; total: number }
  last90Days: { nps: number; promotores: number; pasivos: number; detractores: number; total: number }
  recentResponses: Array<{
    id: string; score: number; categoria: string; comentario: string | null
    createdAt: string; usuario: string; email: string; organizacion: string
  }>
}

type RiskFilter = "todos" | "alto" | "medio" | "bajo"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SUPERADMIN_SLUG = "superadmin"

/** Excluir la org del sistema */
function filterSystemOrgs(orgs: OrgEngagement[]): OrgEngagement[] {
  return orgs.filter(o => o.slug !== SUPERADMIN_SLUG)
}

/** Detectar nombres duplicados */
function getDuplicateNames(orgs: OrgEngagement[]): Set<string> {
  const counts: Record<string, number> = {}
  for (const o of orgs) {
    counts[o.nombre] = (counts[o.nombre] || 0) + 1
  }
  const dupes = new Set<string>()
  for (const [name, count] of Object.entries(counts)) {
    if (count > 1) dupes.add(name)
  }
  return dupes
}

const riesgoBadge = (riesgo: string) => {
  switch (riesgo) {
    case "alto":
      return <Badge variant="destructive">Alto riesgo</Badge>
    case "medio":
      return <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200">Medio</Badge>
    default:
      return <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200">Saludable</Badge>
  }
}

const engagementBar = (score: number) => {
  const color = score >= 50 ? "bg-green-500" : score >= 20 ? "bg-amber-500" : "bg-red-500"
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(2, score)}%` }} />
      </div>
      <span className="text-sm font-medium w-8">{score}</span>
    </div>
  )
}

const EMAIL_TYPE_LABELS: Record<string, string> = {
  WELCOME: "Bienvenida",
  TIP_DAY_3: "Tip día 3",
  TIP_DAY_7: "Tip día 7",
  TRIAL_EXPIRING_5: "Trial -5 días",
  TRIAL_EXPIRING_1: "Trial -1 día",
  TRIAL_EXPIRED: "Trial expirado",
  TRIAL_AUTO_EXTENDED: "Auto-extensión",
  TRIAL_LAST_CHANCE: "Última oportunidad",
  WIN_BACK_7: "Win-back 7d",
  WIN_BACK_30: "Win-back 30d",
}

const EMAIL_GROUP_LABELS: Record<string, string> = {
  CAMPAIGN_TRIAL_EXPIRING: "Trial por vencer",
  CAMPAIGN_TRIAL_EXPIRED: "Trial expirado",
}

function formatDateShort(isoDate: string): string {
  const months = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
  const d = new Date(isoDate)
  return `${d.getDate()} ${months[d.getMonth()]}`
}

function timeAgo(isoDate: string): string {
  const now = new Date()
  const d = new Date(isoDate)
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 60) return `hace ${diffMins}min`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `hace ${diffHours}h`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays === 1) return "hace 1 día"
  return `hace ${diffDays} días`
}

function daysUntil(isoDate: string): number {
  const now = new Date()
  const d = new Date(isoDate)
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

function engagementColor(score: number): string {
  if (score >= 60) return "text-green-600 dark:text-green-400"
  if (score >= 30) return "text-amber-600 dark:text-amber-400"
  return "text-red-600 dark:text-red-400"
}

function npsClassification(nps: number): { label: string; color: string } {
  if (nps > 70) return { label: "Excelente", color: "text-blue-600 dark:text-blue-400" }
  if (nps >= 30) return { label: "Bueno", color: "text-green-600 dark:text-green-400" }
  if (nps >= 0) return { label: "Regular", color: "text-amber-600 dark:text-amber-400" }
  return { label: "Malo", color: "text-red-600 dark:text-red-400" }
}

function npsColor(nps: number): string {
  if (nps > 70) return "text-blue-600 dark:text-blue-400"
  if (nps >= 30) return "text-green-600 dark:text-green-400"
  if (nps >= 0) return "text-amber-600 dark:text-amber-400"
  return "text-red-600 dark:text-red-400"
}

// ---------------------------------------------------------------------------
// Custom chart tooltip
// ---------------------------------------------------------------------------

function ChartTooltipContent({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ value: number; dataKey: string; color: string }>
  label?: string
}) {
  if (!active || !payload || !label) return null
  return (
    <div className="rounded-lg border bg-background p-3 shadow-md text-sm">
      <p className="font-medium mb-1">{formatDateShort(label)}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
          {entry.dataKey === "avgScore" ? "Score" : "Orgs registradas"}: <span className="font-medium">{entry.value}</span>
        </p>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function EngagementContent() {
  const { data, loading, fetchData } = useSuperadminFetch<EngagementData>({ showErrorToast: true })
  const { data: npsData, fetchData: fetchNps } = useSuperadminFetch<NpsData>({ showErrorToast: true })
  const { mutate, loading: mutating } = useSuperadminMutation()

  const [search, setSearch] = useState("")
  const [sortBy, setSortBy] = useState<"engagement" | "ordenes" | "riesgo">("riesgo")
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("todos")

  // Modales
  const [showBroadcast, setShowBroadcast] = useState(false)
  const [broadcastMsg, setBroadcastMsg] = useState({ title: "", message: "" })
  const [showTrialExt, setShowTrialExt] = useState<OrgEngagement | null>(null)
  const [trialForm, setTrialForm] = useState<{ dias: string; motivo: string }>({ dias: "15", motivo: "" })

  const loadData = useCallback(async () => {
    await fetchData("/api/superadmin/stats/engagement")
    await fetchNps("/api/superadmin/stats/nps")
  }, [fetchData, fetchNps])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Excluir org del sistema y calcular métricas
  const clientOrgs = useMemo(() => filterSystemOrgs(data?.organizations || []), [data])
  const duplicateNames = useMemo(() => getDuplicateNames(clientOrgs), [clientOrgs])

  const totalClients = clientOrgs.length
  const highRisk = useMemo(() => clientOrgs.filter(o => o.riesgo === "alto").length, [clientOrgs])
  const mediumRisk = useMemo(() => clientOrgs.filter(o => o.riesgo === "medio").length, [clientOrgs])
  const healthy = totalClients - highRisk - mediumRisk

  const filteredOrgs = useMemo(() => {
    return clientOrgs
      .filter(o => {
        if (riskFilter !== "todos" && o.riesgo !== riskFilter) return false
        if (search) {
          const q = search.toLowerCase()
          return o.nombre.toLowerCase().includes(q) || o.slug.toLowerCase().includes(q)
        }
        return true
      })
      .sort((a, b) => {
        if (sortBy === "riesgo") {
          const order = { alto: 0, medio: 1, bajo: 2 }
          const diff = order[a.riesgo] - order[b.riesgo]
          if (diff !== 0) return diff
          return a.avgEngagement7d - b.avgEngagement7d
        }
        if (sortBy === "ordenes") return b.ordenes7d - a.ordenes7d
        return a.avgEngagement7d - b.avgEngagement7d
      })
  }, [clientOrgs, riskFilter, search, sortBy])

  // Chart data con formato de fechas
  const chartData = useMemo(() => {
    if (!data?.trend) return []
    return data.trend.slice(-30).map(p => ({
      ...p,
      fechaLabel: formatDateShort(p.fecha),
    }))
  }, [data])

  const chartYMax = useMemo(() => {
    if (!chartData.length) return 10
    const maxScore = Math.max(...chartData.map(p => p.avgScore))
    return Math.max(5, Math.ceil(maxScore * 1.3))
  }, [chartData])

  const chartOrgsMax = useMemo(() => {
    if (!chartData.length) return 10
    const maxOrgs = Math.max(...chartData.map(p => p.orgsActivas))
    return Math.ceil(maxOrgs * 1.2)
  }, [chartData])

  // Email stats ordenados por volumen
  const sortedEmailStats = useMemo(() => {
    if (!data?.emailStats) return []
    return Object.entries(data.emailStats)
      .map(([type, stats]) => ({ type, ...stats }))
      .sort((a, b) => b.sent - a.sent)
  }, [data])

  // Acciones
  const handleBroadcastToRisk = async () => {
    if (!broadcastMsg.title || !broadcastMsg.message) return
    const highRiskIds = clientOrgs.filter(o => o.riesgo === "alto").map(o => o.id)
    if (highRiskIds.length === 0) {
      toast.info("No hay organizaciones en riesgo alto")
      return
    }
    await mutate("/api/superadmin/broadcast", {
      method: "POST",
      body: {
        title: broadcastMsg.title,
        message: broadcastMsg.message,
        target: "specific",
        organizationIds: highRiskIds,
        roles: ["ADMIN"],
      },
      successMessage: `Broadcast enviado a ${highRiskIds.length} orgs en riesgo`,
      onSuccess: () => {
        setShowBroadcast(false)
        setBroadcastMsg({ title: "", message: "" })
      },
    })
  }

  const handleExtendTrial = async () => {
    if (!showTrialExt) return
    const diasNum = Math.min(90, Math.max(1, parseInt(trialForm.dias, 10) || 15))
    await mutate("/api/superadmin/trial-extension", {
      method: "POST",
      body: {
        organizationId: showTrialExt.id,
        dias: diasNum,
        motivo: trialForm.motivo || null,
      },
      successMessage: `Trial extendido ${diasNum} días para ${showTrialExt.nombre}`,
      onSuccess: () => {
        setShowTrialExt(null)
        setTrialForm({ dias: "15", motivo: "" })
        loadData()
      },
    })
  }

  // NPS helpers
  const npsAllTime = npsData?.allTime
  const npsResponseRate = npsAllTime && totalClients > 0
    ? Math.round((npsAllTime.total / totalClients) * 100)
    : 0

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* ================================================================ */}
        {/* SECCIÓN 1 — HEADER Y ALERTA DE RIESGO                          */}
        {/* ================================================================ */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold">Engagement y Retención</h1>
            <p className="text-muted-foreground">
              Monitoreo de salud, NPS y acciones de retención
            </p>
            {data?.summary.lastCalculatedAt && (
              <p className="text-xs text-muted-foreground mt-1">
                Último cálculo: {timeAgo(data.summary.lastCalculatedAt + "T00:00:00")}
              </p>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            {loading ? "Cargando..." : "Actualizar"}
          </Button>
        </div>

        {/* Alerta de riesgo */}
        {data && (highRisk > 0 || mediumRisk > 0) && (
          <Card className="border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <AlertTriangle className="h-5 w-5 text-red-600 shrink-0" />
                  <span className="font-medium text-sm">
                    {highRisk} orgs en riesgo alto ({totalClients > 0 ? Math.round((highRisk / totalClients) * 100) : 0}%)
                    {" · "}
                    {mediumRisk} en riesgo medio ({totalClients > 0 ? Math.round((mediumRisk / totalClients) * 100) : 0}%)
                    {" · "}
                    Solo {healthy} saludables ({totalClients > 0 ? Math.round((healthy / totalClients) * 100) : 0}%)
                  </span>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setRiskFilter("alto")
                      document.getElementById("engagement-orgs-table")?.scrollIntoView({
                        behavior: "smooth",
                        block: "start",
                      })
                    }}
                  >
                    <Users className="h-4 w-4 mr-1" />
                    Ver lista filtrada
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      setBroadcastMsg({
                        title: "Te extrañamos en STApp",
                        message: "Hola! Notamos que hace un tiempo no entrás a tu cuenta. Estamos para ayudarte si tenés alguna duda. Respondé a esta notificación o escribinos por soporte.",
                      })
                      setShowBroadcast(true)
                    }}
                  >
                    <Megaphone className="h-4 w-4 mr-1" />
                    Contactar por broadcast
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ================================================================ */}
        {/* SECCIÓN 2 — KPI CARDS                                           */}
        {/* ================================================================ */}
        {loading && !data ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardHeader className="pb-2"><div className="h-4 w-20 bg-muted rounded" /></CardHeader>
                <CardContent><div className="h-7 w-12 bg-muted rounded" /></CardContent>
              </Card>
            ))}
          </div>
        ) : data ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
            {/* 1. Riesgo Alto */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Riesgo Alto</CardTitle>
                <div className="p-2 rounded-lg bg-red-100 dark:bg-red-950"><AlertTriangle className="h-4 w-4 text-red-600" /></div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600">{highRisk} / {totalClients}</div>
                <Progress value={highRisk} max={totalClients || 1} className="mt-2 h-1.5 [&>div]:bg-red-500" />
                <p className="text-xs text-muted-foreground mt-1">{totalClients > 0 ? Math.round((highRisk / totalClients) * 100) : 0}% del total</p>
              </CardContent>
            </Card>

            {/* 2. Saludables */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Saludables</CardTitle>
                <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-950"><Heart className="h-4 w-4 text-emerald-600" /></div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-emerald-600">{healthy} / {totalClients}</div>
                <Progress value={healthy} max={totalClients || 1} className="mt-2 h-1.5 [&>div]:bg-emerald-500" />
                <p className="text-xs text-muted-foreground mt-1">{totalClients > 0 ? Math.round((healthy / totalClients) * 100) : 0}% del total</p>
              </CardContent>
            </Card>

            {/* 3. Engagement */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1 cursor-help">
                      Engagement
                      <Info className="h-3 w-3" />
                    </CardTitle>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[220px]">
                    <p>Promedio últimos 7 días · Escala 0-100. Basado en órdenes, ventas, clientes y actividad reciente.</p>
                  </TooltipContent>
                </Tooltip>
                <div className="p-2 rounded-lg bg-green-100 dark:bg-green-950"><Activity className="h-4 w-4 text-green-600" /></div>
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${engagementColor(data.summary.avgEngagement)}`}>
                  {data.summary.avgEngagement}/100
                </div>
                <p className="text-xs text-muted-foreground mt-1">Promedio últimos 7d</p>
              </CardContent>
            </Card>

            {/* 4. Churn Rate */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Churn Rate</CardTitle>
                <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-950"><TrendingUp className="h-4 w-4 text-purple-600" /></div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{data.summary.churnRate}%</div>
                <p className="text-xs text-muted-foreground mt-1">{data.summary.churnedThisMonth} cancelaciones formales</p>
                {data.summary.churnRate === 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">No refleja inactividad</p>
                )}
              </CardContent>
            </Card>

            {/* 5. NPS Score */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">NPS Score</CardTitle>
                <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-950"><MessageSquare className="h-4 w-4 text-indigo-600" /></div>
              </CardHeader>
              <CardContent>
                {npsAllTime && npsAllTime.total > 0 ? (
                  <>
                    <div className={`text-2xl font-bold ${npsColor(npsAllTime.nps)}`}>
                      {npsAllTime.nps}
                    </div>
                    <Badge variant="secondary" className={`text-xs mt-1 ${npsClassification(npsAllTime.nps).color}`}>
                      {npsClassification(npsAllTime.nps).label}
                    </Badge>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <p className="text-xs text-muted-foreground mt-1 cursor-help">
                          n={npsAllTime.total}
                        </p>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Basado en {npsAllTime.total} respuestas — {npsAllTime.total < 20 ? "volumen bajo, interpretar con cautela" : "volumen razonable"}</p>
                      </TooltipContent>
                    </Tooltip>
                  </>
                ) : (
                  <div className="text-2xl font-bold text-muted-foreground">—</div>
                )}
              </CardContent>
            </Card>

            {/* 6. Orgs Activas */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Orgs Activas</CardTitle>
                <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-950"><Users className="h-4 w-4 text-blue-600" /></div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totalClients}</div>
                <p className="text-xs text-muted-foreground mt-1">Organizaciones de clientes</p>
              </CardContent>
            </Card>
          </div>
        ) : null}

        {/* ================================================================ */}
        {/* SECCIÓN 3 — GRÁFICO TENDENCIA (30 DÍAS)                         */}
        {/* ================================================================ */}
        {chartData.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Tendencia de Engagement (30 días)
              </CardTitle>
              <CardDescription>
                Score promedio de engagement y cantidad de orgs registradas por día
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  {/* Zona roja de alerta si score < 20 */}
                  <ReferenceArea y1={0} y2={Math.min(20, chartYMax)} fill="hsl(0, 80%, 50%)" fillOpacity={0.06} yAxisId="left" />
                  <XAxis
                    dataKey="fecha"
                    tickFormatter={formatDateShort}
                    tick={{ fontSize: 11 }}
                    className="fill-muted-foreground"
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    yAxisId="left"
                    domain={[0, chartYMax]}
                    tick={{ fontSize: 11 }}
                    className="fill-muted-foreground"
                    label={{ value: "Score", angle: -90, position: "insideLeft", style: { fontSize: 11 } }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    domain={[0, chartOrgsMax]}
                    tick={{ fontSize: 11 }}
                    className="fill-muted-foreground"
                    label={{ value: "Orgs", angle: 90, position: "insideRight", style: { fontSize: 11 } }}
                  />
                  <RechartsTooltip content={<ChartTooltipContent />} />
                  <Legend
                    formatter={(value: string) => value === "avgScore" ? "Score engagement" : "Orgs registradas"}
                    wrapperStyle={{ fontSize: 12 }}
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="avgScore"
                    stroke="hsl(0, 80%, 55%)"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="orgsActivas"
                    stroke="hsl(215, 80%, 55%)"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                    strokeDasharray="5 5"
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* ================================================================ */}
        {/* SECCIÓN 4 — TABLA DE ORGS + SIDEBAR                             */}
        {/* ================================================================ */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Organizations Table */}
          <div className="lg:col-span-2" id="engagement-orgs-table">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Salud por Organización
                </CardTitle>

                {/* Filter pills */}
                <div className="flex flex-wrap gap-2 mt-3">
                  {([
                    { key: "todos" as const, label: `Todos (${totalClients})`, variant: "outline" as const },
                    { key: "alto" as const, label: `Alto riesgo (${highRisk})`, variant: "destructive" as const },
                    { key: "medio" as const, label: `Medio (${mediumRisk})`, variant: "secondary" as const },
                    { key: "bajo" as const, label: `Saludables (${healthy})`, variant: "secondary" as const },
                  ]).map(f => (
                    <Button
                      key={f.key}
                      size="sm"
                      variant={riskFilter === f.key ? "default" : "outline"}
                      className={
                        riskFilter === f.key
                          ? f.key === "alto" ? "bg-red-600 hover:bg-red-700 text-white" :
                            f.key === "medio" ? "bg-amber-500 hover:bg-amber-600 text-white" :
                            f.key === "bajo" ? "bg-green-600 hover:bg-green-700 text-white" : ""
                          : "text-xs"
                      }
                      onClick={() => setRiskFilter(f.key)}
                    >
                      {f.label}
                    </Button>
                  ))}
                </div>

                <div className="flex gap-2 mt-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Buscar organización..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setSortBy(s => s === "riesgo" ? "engagement" : s === "engagement" ? "ordenes" : "riesgo")}>
                    <ArrowUpDown className="h-4 w-4 mr-1" />
                    {sortBy === "riesgo" ? "Riesgo" : sortBy === "engagement" ? "Score" : "Órdenes"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {/* Contador */}
                <p className="text-xs text-muted-foreground mb-2">
                  Mostrando {filteredOrgs.length} {riskFilter !== "todos" ? `orgs en ${riskFilter === "alto" ? "alto riesgo" : riskFilter === "medio" ? "riesgo medio" : "estado saludable"}` : "organizaciones"}
                </p>

                <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
                  {filteredOrgs.map(org => {
                    const trialDaysLeft = org.trialEnd ? daysUntil(org.trialEnd) : null
                    const isDuplicate = duplicateNames.has(org.nombre)
                    const orgAge = Math.floor((new Date().getTime() - new Date(org.createdAt).getTime()) / (1000 * 60 * 60 * 24))

                    return (
                      <div key={org.id} className="flex items-center justify-between py-3 px-3 border rounded-lg hover:bg-muted/50 transition-colors">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-medium truncate">{org.nombre}</p>
                            {isDuplicate && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="text-amber-500 shrink-0 cursor-help">
                                    <AlertTriangle className="h-3.5 w-3.5" />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>Posible duplicado: existe otra org con el mismo nombre</TooltipContent>
                              </Tooltip>
                            )}
                            <Badge variant="outline" className="text-xs shrink-0">{org.plan}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">{org.slug}.stapp.com.ar</p>
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                            <span>Score: <span className={`font-medium ${engagementColor(org.avgEngagement7d)}`}>{org.avgEngagement7d}/100</span></span>
                            {org.subscriptionStatus === "TRIALING" && trialDaysLeft !== null && (
                              <span className={trialDaysLeft <= 3 ? "text-red-600 dark:text-red-400 font-medium" : ""}>
                                Trial · {trialDaysLeft > 0 ? `${trialDaysLeft}d restantes` : "Vencido"}
                              </span>
                            )}
                            {org.subscriptionStatus === "ACTIVE" && (
                              <span className="text-green-600 dark:text-green-400">Activa</span>
                            )}
                            <span>Registrada hace {orgAge}d</span>
                            {org.ultimaActividad && (
                              <span>Último acceso: {timeAgo(org.ultimaActividad)}</span>
                            )}
                            {!org.ultimaActividad && (
                              <span className="text-red-500">Sin actividad</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-right hidden sm:block">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <p className="text-sm font-medium cursor-help">{org.ordenes7d} órd.</p>
                              </TooltipTrigger>
                              <TooltipContent>Órdenes de trabajo (últimos 7 días)</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <p className="text-xs text-muted-foreground cursor-help">{org.ventas7d} ventas</p>
                              </TooltipTrigger>
                              <TooltipContent>Presupuestos / ventas (últimos 7 días)</TooltipContent>
                            </Tooltip>
                          </div>
                          <div className="hidden md:block">
                            {engagementBar(org.avgEngagement7d)}
                          </div>
                          {riesgoBadge(org.riesgo)}

                          {/* Menú de acciones */}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => window.open(`/superadmin/organizations/${org.id}`, "_blank")}>
                                <ExternalLink className="h-4 w-4 mr-2" />
                                Ver organización
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => {
                                setBroadcastMsg({
                                  title: "Mensaje de STApp",
                                  message: `Hola ${org.nombre}! `,
                                })
                                setShowBroadcast(true)
                              }}>
                                <Mail className="h-4 w-4 mr-2" />
                                Enviar mensaje
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => {
                                setShowTrialExt(org)
                                setTrialForm({ dias: "15", motivo: "" })
                              }}>
                                <Clock className="h-4 w-4 mr-2" />
                                Extender trial
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    )
                  })}
                  {filteredOrgs.length === 0 && (
                    <p className="text-center text-muted-foreground py-8">No hay organizaciones que coincidan</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ============================================================== */}
          {/* SIDEBAR — NPS, Lifecycle Emails, Cancelaciones                 */}
          {/* ============================================================== */}
          <div className="space-y-6">

            {/* SECCIÓN 5 — NPS SCORE */}
            {npsData && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MessageSquare className="h-5 w-5" />
                    NPS Score
                  </CardTitle>
                  <CardDescription>Net Promoter Score</CardDescription>
                </CardHeader>
                <CardContent>
                  {npsAllTime && npsAllTime.total > 0 ? (
                    <>
                      <div className="text-center mb-4">
                        <div className={`text-5xl font-bold ${npsColor(npsAllTime.nps)}`}>
                          {npsAllTime.nps}
                        </div>
                        <Badge variant="secondary" className={`mt-1 ${npsClassification(npsAllTime.nps).color}`}>
                          {npsClassification(npsAllTime.nps).label}
                        </Badge>
                        <p className="text-xs text-muted-foreground mt-2">
                          {npsResponseRate}% de respuesta ({npsAllTime.total} de {totalClients} orgs)
                        </p>
                      </div>

                      {/* Barra visual proporcional */}
                      <div className="mb-4">
                        <div className="flex h-3 rounded-full overflow-hidden">
                          {npsAllTime.promotores > 0 && (
                            <div
                              className="bg-green-500"
                              style={{ width: `${(npsAllTime.promotores / npsAllTime.total) * 100}%` }}
                              title={`Promotores: ${npsAllTime.promotores}`}
                            />
                          )}
                          {npsAllTime.pasivos > 0 && (
                            <div
                              className="bg-amber-400"
                              style={{ width: `${(npsAllTime.pasivos / npsAllTime.total) * 100}%` }}
                              title={`Pasivos: ${npsAllTime.pasivos}`}
                            />
                          )}
                          {npsAllTime.detractores > 0 && (
                            <div
                              className="bg-red-500"
                              style={{ width: `${(npsAllTime.detractores / npsAllTime.total) * 100}%` }}
                              title={`Detractores: ${npsAllTime.detractores}`}
                            />
                          )}
                        </div>
                        <div className="flex justify-between text-xs text-muted-foreground mt-1">
                          <span className="text-green-600">
                            Promotores {Math.round((npsAllTime.promotores / npsAllTime.total) * 100)}%
                          </span>
                          <span className="text-amber-600">
                            Pasivos {Math.round((npsAllTime.pasivos / npsAllTime.total) * 100)}%
                          </span>
                          <span className="text-red-600">
                            Detractores {Math.round((npsAllTime.detractores / npsAllTime.total) * 100)}%
                          </span>
                        </div>
                      </div>

                      {/* Breakdown */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-1.5">
                            <ThumbsUp className="h-3.5 w-3.5 text-green-600" />
                            <span>Promotores (9-10)</span>
                          </div>
                          <span className="font-medium text-green-600">{npsAllTime.promotores}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-1.5">
                            <Minus className="h-3.5 w-3.5 text-amber-600" />
                            <span>Pasivos (7-8)</span>
                          </div>
                          <span className="font-medium text-amber-600">{npsAllTime.pasivos}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-1.5">
                            <ThumbsDown className="h-3.5 w-3.5 text-red-600" />
                            <span>Detractores (0-6)</span>
                          </div>
                          <span className="font-medium text-red-600">{npsAllTime.detractores}</span>
                        </div>
                      </div>

                      {/* Todos los comentarios con scroll */}
                      {npsData.recentResponses.filter(r => r.comentario).length > 0 && (
                        <div className="mt-4 pt-4 border-t space-y-2">
                          <p className="text-xs font-medium text-muted-foreground uppercase">
                            Comentarios ({npsData.recentResponses.filter(r => r.comentario).length})
                          </p>
                          <div className="max-h-[400px] overflow-y-auto space-y-2 pr-1">
                            {npsData.recentResponses.filter(r => r.comentario).map(r => (
                              <div key={r.id} className="p-2 bg-muted/50 rounded text-sm">
                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                  <Badge
                                    variant={r.categoria === "PROMOTOR" ? "default" : r.categoria === "DETRACTOR" ? "destructive" : "secondary"}
                                    className={`text-xs ${
                                      r.categoria === "PROMOTOR" ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200" :
                                      r.categoria === "DETRACTOR" ? "" : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                                    }`}
                                  >
                                    {r.score}
                                  </Badge>
                                  <span className="text-xs font-medium">{r.organizacion}</span>
                                  <span className="text-xs text-muted-foreground">{timeAgo(r.createdAt)}</span>
                                </div>
                                <p className="text-muted-foreground text-xs">{r.comentario}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Botón enviar encuesta */}
                      <div className="mt-4 pt-4 border-t">
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={() => window.open("/superadmin/lifecycle-emails", "_self")}
                        >
                          <Mail className="h-4 w-4 mr-2" />
                          Enviar encuesta NPS
                        </Button>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      Sin respuestas NPS aún
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* SECCIÓN 6 — LIFECYCLE EMAILS (30d) */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mail className="h-5 w-5" />
                  Lifecycle Emails (30d)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {sortedEmailStats.length > 0 ? (
                    <>
                      {sortedEmailStats.map(({ type, sent, failed }) => (
                        <div key={type} className="flex items-center justify-between">
                          <span className="text-sm">{EMAIL_TYPE_LABELS[type] || EMAIL_GROUP_LABELS[type] || type}</span>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200">
                              {sent} enviados
                            </Badge>
                            {failed > 0 && (
                              <Badge variant="destructive">{failed} fallidos</Badge>
                            )}
                          </div>
                        </div>
                      ))}
                      <div className="pt-2 border-t">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full text-xs"
                          onClick={() => window.open("/superadmin/lifecycle-emails", "_self")}
                        >
                          Ver historial completo
                          <ExternalLink className="h-3 w-3 ml-1" />
                        </Button>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      Sin datos aún. Los emails se envían automáticamente.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* SECCIÓN 7 — CANCELACIONES (30d) */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingDown className="h-5 w-5" />
                  Cancelaciones (30d)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {/* Cancelaciones formales */}
                  {data && data.churned.length > 0 ? (
                    data.churned.map(c => (
                      <div key={c.organizationId} className="flex items-center justify-between py-2 border-b last:border-0">
                        <div className="flex items-center gap-2">
                          <XCircle className="h-4 w-4 text-red-500" />
                          <span className="text-sm font-medium">{c.nombre}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {new Date(c.canceledAt).toLocaleDateString("es-AR")}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                      <CheckCircle2 className="h-4 w-4" />
                      0 cancelaciones de suscripciones pagas
                    </div>
                  )}

                  {/* Trials vencidos sin conversión */}
                  {data && data.trialsExpiredWithoutConversion > 0 && (
                    <div className="pt-3 border-t">
                      <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="h-4 w-4" />
                        <span>
                          Churn real: {data.trialsExpiredWithoutConversion} trials vencidos sin pagar
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full text-xs mt-2"
                        onClick={() => window.open("/superadmin/subscriptions", "_self")}
                      >
                        Ver suscripciones
                        <ExternalLink className="h-3 w-3 ml-1" />
                      </Button>
                    </div>
                  )}

                  {data && data.churned.length === 0 && (!data.trialsExpiredWithoutConversion || data.trialsExpiredWithoutConversion === 0) && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Sin actividad de churn este mes
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ================================================================ */}
        {/* MODALES                                                          */}
        {/* ================================================================ */}

        {/* Modal: Broadcast a orgs en riesgo */}
        <Dialog open={showBroadcast} onOpenChange={setShowBroadcast}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Megaphone className="h-5 w-5" />
                Contactar organizaciones en riesgo alto
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Se enviará una notificación in-app a los admins de {highRisk} organizaciones con riesgo alto.
            </p>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Título</Label>
                <Input
                  value={broadcastMsg.title}
                  onChange={e => setBroadcastMsg(m => ({ ...m, title: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Mensaje</Label>
                <Textarea
                  value={broadcastMsg.message}
                  onChange={e => setBroadcastMsg(m => ({ ...m, message: e.target.value }))}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowBroadcast(false)}>Cancelar</Button>
              <Button variant="destructive" onClick={handleBroadcastToRisk} disabled={mutating || !broadcastMsg.title || !broadcastMsg.message}>
                {mutating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Megaphone className="h-4 w-4 mr-2" />}
                Enviar a {highRisk} orgs
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Modal: Extender trial */}
        <Dialog open={!!showTrialExt} onOpenChange={(open) => !open && setShowTrialExt(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Extender trial: {showTrialExt?.nombre}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Días a extender</Label>
                <Input
                  type="number"
                  min={1}
                  max={90}
                  value={trialForm.dias}
                  onChange={e => setTrialForm(f => ({ ...f, dias: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">Máximo 90 días</p>
              </div>
              <div className="space-y-2">
                <Label>Motivo (opcional)</Label>
                <Textarea
                  placeholder="Ej: cliente prometedor, pidió más tiempo para evaluar..."
                  value={trialForm.motivo}
                  onChange={e => setTrialForm(f => ({ ...f, motivo: e.target.value }))}
                  rows={2}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowTrialExt(null)}>Cancelar</Button>
              <Button onClick={handleExtendTrial} disabled={mutating || (parseInt(trialForm.dias, 10) || 0) < 1}>
                {mutating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Extender {trialForm.dias} días
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  )
}
