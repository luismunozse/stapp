"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DataTable, Column } from "@/components/ui/data-table"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  FileText,
  ChevronDown,
  ChevronUp,
  Shield,
  Activity,
  Download,
  AlertTriangle,
  LogIn,
  LogOut,
  XCircle,
  Settings,
  Search,
  BarChart3,
  Clock,
  Users,
  TrendingUp,
  Zap,
  Database,
  Sliders,
} from "lucide-react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Cell,
} from "recharts"
import { formatDateTime } from "@/lib/utils"
import { useSuperadminFetch, useSuperadminMutation } from "@/hooks/use-superadmin-fetch"
import { useLastUpdated } from "@/hooks/use-last-updated"
import { LastUpdated } from "@/components/superadmin/last-updated"
import type { AuditLogWithRelations } from "@/types/superadmin"

// ---------------------------------------------------------------------------
// Constants & Helpers
// ---------------------------------------------------------------------------

const ACTION_LABELS: Record<string, string> = {
  CREATE: "Crear",
  UPDATE: "Actualizar",
  DELETE: "Eliminar",
  LOGIN: "Login",
  LOGOUT: "Logout",
  LOGIN_FAILED: "Login Fallido",
  TOGGLE_STATUS: "Cambiar Estado",
  BROADCAST: "Broadcast",
  EMAIL_CAMPAIGN: "Campaña Email",
  CRON_RUN: "Cron Manual",
  SUBSCRIPTION_RENEW: "Renovar Suscripción",
  TRIAL_EXTENSION: "Extender Trial",
  EXPORT: "Exportar",
  PLAN_TOGGLE: "Toggle Plan",
  BULK_ACTION: "Acción Masiva",
  TICKET_REPLY: "Respuesta Soporte",
  VERIFY_EMAIL: "Verificar Email",
}

const ACTION_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  CREATE: "default",
  UPDATE: "secondary",
  DELETE: "destructive",
  LOGIN: "default",
  LOGOUT: "outline",
  LOGIN_FAILED: "destructive",
  TOGGLE_STATUS: "secondary",
  BROADCAST: "default",
  EMAIL_CAMPAIGN: "default",
  CRON_RUN: "outline",
  SUBSCRIPTION_RENEW: "default",
  TRIAL_EXTENSION: "default",
  EXPORT: "outline",
  PLAN_TOGGLE: "secondary",
  BULK_ACTION: "secondary",
  TICKET_REPLY: "default",
  VERIFY_EMAIL: "default",
}

const ACTION_ICONS: Record<string, typeof LogIn> = {
  LOGIN: LogIn,
  LOGOUT: LogOut,
  LOGIN_FAILED: XCircle,
}

const ENTITY_LABELS: Record<string, string> = {
  organizations: "Organizaciones",
  users: "Usuarios",
  subscriptions: "Suscripciones",
  plans: "Planes",
  payments: "Pagos",
  broadcasts: "Broadcasts",
  email_campaigns: "Campañas Email",
  support_tickets: "Soporte",
  cron_jobs: "Cron Jobs",
  sessions: "Sesiones",
  system: "Sistema",
  ordenes_servicio: "Órdenes",
  clientes: "Clientes",
  inventario: "Inventario",
  proveedores: "Proveedores",
  cotizaciones: "Cotizaciones",
  facturas: "Remitos",
  garantias: "Garantías",
  ventas: "Ventas",
  checklist_templates: "Checklists",
  devoluciones_venta: "Devoluciones",
  movimientos_inventario: "Mov. Inventario",
  changelog: "Changelog",
  waitlist: "Waitlist",
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HourlyPoint {
  hour: number
  count: number
}

interface DailyPoint {
  date: string
  count: number
}

interface HighActivityUser {
  userId: string
  email: string | null
  count: number
}

interface StorageEstimate {
  totalRows: number
  oldestRecord: string | null
  newestRecord: string | null
}

interface AlertConfig {
  user_activity_threshold: number
  user_activity_window_hours: number
  failed_login_threshold: number
  failed_login_window_hours: number
  retention_days: number
}

// Form state holds raw strings so the user can freely clear/type the inputs.
// Parsed and clamped to valid numbers at save time (handleSaveAlertConfig).
interface AlertConfigForm {
  user_activity_threshold: string
  user_activity_window_hours: string
  failed_login_threshold: string
  failed_login_window_hours: string
  retention_days: string
}

interface AuditStats {
  total: number
  today: number
  last7Days: number
  last30Days: number
  loginsFailed7Days: number
  loginsSuccess7Days: number
  actionDistribution: Record<string, number>
  entityDistribution: Record<string, number>
  securityEvents: Array<{
    id: string
    action: string
    email: string | null
    description: string | null
    ipAddress: string | null
    isSuperadmin: boolean
    createdAt: string
  }>
  topUsers: Array<{
    userId: string
    email: string | null
    actionCount: number
  }>
  hourlyDistribution: HourlyPoint[]
  dailyDistribution: DailyPoint[]
  highActivityUsers: HighActivityUser[]
  storageEstimate: StorageEstimate
  alertConfig: AlertConfig
}

// ---------------------------------------------------------------------------
// Risk score badge
// ---------------------------------------------------------------------------

function calculateRiskIndicators(log: AuditLogWithRelations): { score: number; reasons: string[] } {
  const reasons: string[] = []
  let score = 0

  // DELETE fuera de horario (antes de 7am o después de 10pm)
  if (log.action === "DELETE") {
    const hour = new Date(log.created_at).getHours()
    if (hour < 7 || hour >= 22) {
      score += 40
      reasons.push("Eliminación fuera de horario")
    } else {
      score += 15
      reasons.push("Acción de eliminación")
    }
  }

  // LOGIN_FAILED
  if (log.action === "LOGIN_FAILED") {
    score += 30
    reasons.push("Intento de login fallido")
  }

  // BULK_ACTION
  if (log.action === "BULK_ACTION") {
    score += 20
    reasons.push("Acción masiva")
  }

  return { score, reasons }
}

function RiskBadge({ score, reasons }: { score: number; reasons: string[] }) {
  if (score < 20) return null

  const variant = score >= 40 ? "destructive" : "secondary"
  const label = score >= 40 ? "Alto" : "Medio"
  const colorClass = score >= 40
    ? ""
    : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant={variant} className={`text-[10px] px-1.5 ${colorClass}`}>
          <Zap className="h-2.5 w-2.5 mr-0.5" />
          {label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        <p className="font-medium mb-1">Score de riesgo: {score}</p>
        {reasons.map((r, i) => (
          <p key={i} className="text-xs">• {r}</p>
        ))}
      </TooltipContent>
    </Tooltip>
  )
}

// ---------------------------------------------------------------------------
// Chart tooltip
// ---------------------------------------------------------------------------

function HourlyTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ value: number }>
  label?: string | number
}) {
  if (!active || !payload?.[0]) return null
  return (
    <div className="rounded-lg border bg-background p-2 shadow-md text-xs">
      <p className="font-medium">{String(label).padStart(2, "0")}:00 - {String(label).padStart(2, "0")}:59</p>
      <p>{payload[0].value} eventos</p>
    </div>
  )
}

function DailyTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ value: number }>
  label?: string
}) {
  if (!active || !payload?.[0]) return null
  return (
    <div className="rounded-lg border bg-background p-2 shadow-md text-xs">
      <p className="font-medium">{label}</p>
      <p>{payload[0].value} eventos</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50

export default function LogsPage() {
  const [activeTab, setActiveTab] = useState("all")
  const [entityFilter, setEntityFilter] = useState("")
  const [actionFilter, setActionFilter] = useState("")
  const [orgFilter, setOrgFilter] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [searchInput, setSearchInput] = useState("")
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [logs, setLogs] = useState<AuditLogWithRelations[]>([])
  const [stats, setStats] = useState<AuditStats | null>(null)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState(false)
  const [organizations, setOrganizations] = useState<Array<{ id: string; nombre: string }>>([])
  const [chartView, setChartView] = useState<"hourly" | "daily">("hourly")
  const [showAlertConfig, setShowAlertConfig] = useState(false)
  const [alertForm, setAlertForm] = useState<AlertConfigForm>({
    user_activity_threshold: "100",
    user_activity_window_hours: "1",
    failed_login_threshold: "5",
    failed_login_window_hours: "24",
    retention_days: "90",
  })

  const { loading, fetchData } = useSuperadminFetch<{
    logs: AuditLogWithRelations[]
    total: number
  }>()
  const { loading: statsLoading, fetchData: fetchStatsData } =
    useSuperadminFetch<AuditStats>()
  const { mutate, loading: saving } = useSuperadminMutation()
  const { formattedLastUpdated, markUpdated } = useLastUpdated()

  // Cargar lista de organizaciones para el filtro
  useEffect(() => {
    const loadOrgs = async () => {
      try {
        const res = await fetch("/api/superadmin/organizations?limit=500")
        if (res.ok) {
          const data = await res.json()
          setOrganizations(
            (data.organizations || []).map((o: { id: string; nombre: string }) => ({
              id: o.id,
              nombre: o.nombre,
            }))
          )
        }
      } catch {
        // silencioso
      }
    }
    loadOrgs()
  }, [])

  const fetchStats = useCallback(async () => {
    const result = await fetchStatsData("/api/superadmin/audit-logs/stats")
    if (result) {
      setStats(result)
      setAlertForm({
        user_activity_threshold: String(result.alertConfig?.user_activity_threshold ?? 100),
        user_activity_window_hours: String(result.alertConfig?.user_activity_window_hours ?? 1),
        failed_login_threshold: String(result.alertConfig?.failed_login_threshold ?? 5),
        failed_login_window_hours: String(result.alertConfig?.failed_login_window_hours ?? 24),
        retention_days: String(result.alertConfig?.retention_days ?? 90),
      })
      markUpdated()
    }
  }, [fetchStatsData, markUpdated])

  const fetchLogs = useCallback(async () => {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: PAGE_SIZE.toString(),
      tab: activeTab,
      ...(entityFilter && { entity: entityFilter }),
      ...(actionFilter && { action: actionFilter }),
      ...(orgFilter && { organizationId: orgFilter }),
      ...(dateFrom && { dateFrom }),
      ...(dateTo && { dateTo }),
      ...(searchQuery && { search: searchQuery }),
    })

    const result = await fetchData(`/api/superadmin/audit-logs?${params}`)
    if (result) {
      setLogs(result.logs || [])
      setTotal(result.total || 0)
      markUpdated()
    }
  }, [page, activeTab, entityFilter, actionFilter, orgFilter, dateFrom, dateTo, searchQuery, fetchData, markUpdated])

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  // Debounce de búsqueda
  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearchQuery(searchInput)
      setPage(1)
    }, 400)
    return () => clearTimeout(timeout)
  }, [searchInput])

  const handleTabChange = (tab: string) => {
    setActiveTab(tab)
    setPage(1)
    setActionFilter("")
    setEntityFilter("")
  }

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const params = new URLSearchParams({
        tab: activeTab,
        ...(entityFilter && { entity: entityFilter }),
        ...(actionFilter && { action: actionFilter }),
        ...(orgFilter && { organizationId: orgFilter }),
        ...(dateFrom && { dateFrom }),
        ...(dateTo && { dateTo }),
        ...(searchQuery && { search: searchQuery }),
      })

      const response = await fetch(`/api/superadmin/audit-logs/export?${params}`)

      if (response.ok) {
        const blob = await response.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `audit-logs-${new Date().toISOString().split("T")[0]}.csv`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }
    } catch (err) {
      console.error("Error exporting:", err)
    } finally {
      setExporting(false)
    }
  }

  const handleSaveAlertConfig = async () => {
    const alertConfigBody: AlertConfig = {
      user_activity_threshold: Math.min(10000, Math.max(10, parseInt(alertForm.user_activity_threshold, 10) || 100)),
      user_activity_window_hours: Math.min(168, Math.max(1, parseInt(alertForm.user_activity_window_hours, 10) || 1)),
      failed_login_threshold: Math.min(1000, Math.max(1, parseInt(alertForm.failed_login_threshold, 10) || 5)),
      failed_login_window_hours: Math.min(168, Math.max(1, parseInt(alertForm.failed_login_window_hours, 10) || 24)),
      retention_days: Math.min(365, Math.max(30, parseInt(alertForm.retention_days, 10) || 90)),
    }
    await mutate("/api/superadmin/audit-logs/alert-config", {
      method: "PUT",
      body: alertConfigBody,
      successMessage: "Configuración de alertas actualizada",
      onSuccess: () => {
        setShowAlertConfig(false)
        fetchStats()
      },
    })
  }

  // Hourly chart data padded to 24h
  const hourlyData = useMemo(() => {
    const map = new Map<number, number>()
    for (const p of stats?.hourlyDistribution || []) {
      map.set(p.hour, p.count)
    }
    return Array.from({ length: 24 }, (_, h) => ({
      hour: `${String(h).padStart(2, "0")}`,
      count: map.get(h) || 0,
      label: h,
    }))
  }, [stats])

  // Daily chart data formatted
  const dailyData = useMemo(() => {
    return (stats?.dailyDistribution || []).map((p) => {
      const d = new Date(p.date + "T12:00:00")
      const months = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
      return {
        date: `${d.getDate()} ${months[d.getMonth()]}`,
        count: p.count,
      }
    })
  }, [stats])

  // Retention estimates
  const retentionInfo = useMemo(() => {
    if (!stats?.storageEstimate || !stats.alertConfig) return null
    const { totalRows, oldestRecord } = stats.storageEstimate
    const retentionDays = stats.alertConfig.retention_days
    if (!oldestRecord) return null

    const oldestDate = new Date(oldestRecord)
    const now = new Date()
    const ageInDays = Math.floor((now.getTime() - oldestDate.getTime()) / (1000 * 60 * 60 * 24))
    const usagePercent = Math.min(100, Math.round((ageInDays / retentionDays) * 100))

    return { totalRows, ageInDays, retentionDays, usagePercent }
  }, [stats])

  // Expanded row renderer
  const renderExpandedRow = (log: AuditLogWithRelations) => {
    if (!log.changes) return null
    const changes = log.changes as Record<string, unknown>
    const displayChanges = { ...changes }
    delete displayChanges.performer_email
    delete displayChanges.is_superadmin_action
    delete displayChanges.description

    return (
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-muted-foreground">
            Detalles — {ENTITY_LABELS[log.entity] || log.entity} (
            {ACTION_LABELS[log.action] || log.action}) —{" "}
            {formatDateTime(log.created_at)}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => toggleRow(log.id)}
          >
            <ChevronUp className="h-3 w-3" />
          </Button>
        </div>

        {/* Descripción legible */}
        {log.description && (
          <p className="text-sm mb-3 p-2 rounded bg-blue-50 dark:bg-blue-950/30 text-blue-800 dark:text-blue-200 border border-blue-100 dark:border-blue-900">
            {log.description}
          </p>
        )}

        {/* Diff antes/después */}
        {changes.before && changes.after ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <span className="text-xs font-medium text-destructive/80 mb-1 block">
                Antes:
              </span>
              <pre className="text-xs overflow-x-auto p-2 bg-destructive/5 rounded border border-destructive/10">
                {JSON.stringify(changes.before, null, 2)}
              </pre>
            </div>
            <div>
              <span className="text-xs font-medium text-green-600 dark:text-green-400 mb-1 block">
                Después:
              </span>
              <pre className="text-xs overflow-x-auto p-2 bg-green-500/5 rounded border border-green-500/10">
                {JSON.stringify(changes.after, null, 2)}
              </pre>
            </div>
          </div>
        ) : Object.keys(displayChanges).length > 0 ? (
          <pre className="text-xs overflow-x-auto p-2 bg-muted rounded">
            {JSON.stringify(displayChanges, null, 2)}
          </pre>
        ) : null}

        {/* Metadata: IP, User Agent, Entity ID */}
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
          {log.ip_address && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted">
              IP: <span className="font-mono">{log.ip_address}</span>
            </span>
          )}
          {log.user_agent && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted truncate max-w-[400px]">
              UA: {log.user_agent}
            </span>
          )}
          {log.entity_id && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted">
              Entity ID: <span className="font-mono">{log.entity_id}</span>
            </span>
          )}
        </div>
      </div>
    )
  }

  // Table columns
  const columns: Column<AuditLogWithRelations>[] = [
    {
      key: "created_at",
      header: "Fecha",
      render: (log) => (
        <span className="text-sm whitespace-nowrap">
          {formatDateTime(log.created_at)}
        </span>
      ),
    },
    {
      key: "action",
      header: "Acción",
      render: (log) => {
        const Icon = ACTION_ICONS[log.action]
        const { score, reasons } = calculateRiskIndicators(log)
        return (
          <div className="flex items-center gap-1.5">
            {Icon && <Icon className="h-3.5 w-3.5" />}
            <Badge variant={ACTION_VARIANTS[log.action] || "secondary"}>
              {ACTION_LABELS[log.action] || log.action}
            </Badge>
            <RiskBadge score={score} reasons={reasons} />
          </div>
        )
      },
    },
    {
      key: "entity",
      header: "Entidad",
      render: (log) => (
        <span className="text-sm">
          {ENTITY_LABELS[log.entity] || log.entity}
        </span>
      ),
    },
    {
      key: "organizations",
      header: "Organización",
      hideOnMobile: true,
      render: (log) =>
        log.organizations ? (
          <div>
            <div className="font-medium text-sm">
              {log.organizations.nombre}
            </div>
            <div className="text-xs text-muted-foreground">
              {log.organizations.slug}
            </div>
          </div>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        ),
    },
    {
      key: "users",
      header: "Usuario",
      hideOnMobile: true,
      render: (log) => {
        if (log.users) {
          return (
            <div>
              <div className="font-medium text-sm">{log.users.nombre}</div>
              <div className="text-xs text-muted-foreground">
                {log.users.email}
              </div>
            </div>
          )
        }
        if (log.performer_email) {
          return (
            <div>
              <div className="font-medium text-sm flex items-center gap-1">
                <Shield className="h-3 w-3 text-amber-500" />
                Superadmin
              </div>
              <div className="text-xs text-muted-foreground">
                {log.performer_email}
              </div>
            </div>
          )
        }
        return (
          <span className="text-muted-foreground text-sm">Sistema</span>
        )
      },
    },
    {
      key: "description",
      header: "Descripción",
      hideOnMobile: true,
      render: (log) =>
        log.description ? (
          <span className="text-sm text-muted-foreground line-clamp-2 max-w-[300px]">
            {log.description}
          </span>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        ),
    },
    {
      key: "ip_address",
      header: "IP",
      hideOnMobile: true,
      render: (log) => (
        <span className="text-xs text-muted-foreground font-mono">
          {log.ip_address || "—"}
        </span>
      ),
    },
    {
      key: "changes",
      header: "",
      render: (log) =>
        log.changes ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation()
              toggleRow(log.id)
            }}
          >
            {expandedRows.has(log.id) ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        ) : null,
    },
  ]

  const hasFilters =
    dateFrom || dateTo || actionFilter || entityFilter || searchInput || orgFilter

  // Actions for current tab
  const getActionsForTab = () => {
    if (activeTab === "security") {
      return [
        { value: "LOGIN", label: "Login" },
        { value: "LOGOUT", label: "Logout" },
        { value: "LOGIN_FAILED", label: "Login Fallido" },
      ]
    }
    if (activeTab === "superadmin") {
      return [
        { value: "TOGGLE_STATUS", label: "Cambiar Estado" },
        { value: "BROADCAST", label: "Broadcast" },
        { value: "EMAIL_CAMPAIGN", label: "Campaña Email" },
        { value: "CRON_RUN", label: "Cron Manual" },
        { value: "SUBSCRIPTION_RENEW", label: "Renovar Suscripción" },
        { value: "TRIAL_EXTENSION", label: "Extender Trial" },
        { value: "PLAN_TOGGLE", label: "Toggle Plan" },
        { value: "BULK_ACTION", label: "Acción Masiva" },
        { value: "TICKET_REPLY", label: "Resp. Soporte" },
        { value: "VERIFY_EMAIL", label: "Verificar Email" },
        { value: "EXPORT", label: "Exportar" },
      ]
    }
    return [
      { value: "CREATE", label: "Crear" },
      { value: "UPDATE", label: "Actualizar" },
      { value: "DELETE", label: "Eliminar" },
      { value: "LOGIN", label: "Login" },
      { value: "LOGOUT", label: "Logout" },
      { value: "LOGIN_FAILED", label: "Login Fallido" },
      { value: "TOGGLE_STATUS", label: "Cambiar Estado" },
      { value: "BROADCAST", label: "Broadcast" },
      { value: "EMAIL_CAMPAIGN", label: "Campaña Email" },
      { value: "CRON_RUN", label: "Cron Manual" },
      { value: "SUBSCRIPTION_RENEW", label: "Renovar Suscripción" },
      { value: "TRIAL_EXTENSION", label: "Extender Trial" },
      { value: "EXPORT", label: "Exportar" },
    ]
  }

  // Alert threshold for failed logins (use configured value)
  const failedLoginThreshold = stats?.alertConfig?.failed_login_threshold ?? 5

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Shield className="h-8 w-8" />
              Auditoría del Sistema
            </h1>
            <p className="text-muted-foreground">
              Registro completo de todas las acciones, eventos de seguridad y
              operaciones del sistema
            </p>
            <LastUpdated
              formattedLastUpdated={formattedLastUpdated}
              onRefresh={() => {
                fetchLogs()
                fetchStats()
              }}
              loading={loading || statsLoading}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAlertConfig(true)}
            className="gap-1.5"
          >
            <Sliders className="h-4 w-4" />
            Configurar alertas
          </Button>
        </div>

        {/* ============================================================ */}
        {/* ALERTAS ACTIVAS                                              */}
        {/* ============================================================ */}

        {/* Alerta: Logins fallidos */}
        {stats && stats.loginsFailed7Days > failedLoginThreshold && (() => {
          const lastFailed = stats.securityEvents
            ?.filter((e) => e.action === "LOGIN_FAILED")
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
          return (
            <Card className="border-destructive/50 bg-destructive/5">
              <CardContent className="p-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-destructive">
                      Alto número de intentos fallidos de login
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Se detectaron {stats.loginsFailed7Days} intentos fallidos en los últimos 7 días
                      {" "}(umbral: {failedLoginThreshold}).
                      {lastFailed && (
                        <>
                          {" "}Último intento: <strong>{formatDateTime(lastFailed.createdAt)}</strong>
                          {lastFailed.ipAddress && <> desde IP <code className="px-1 py-0.5 bg-muted rounded text-[11px]">{lastFailed.ipAddress}</code></>}
                          {lastFailed.email && <> · {lastFailed.email}</>}.
                        </>
                      )}
                    </p>
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 mt-2 text-destructive"
                      onClick={() => handleTabChange("security")}
                    >
                      Ver detalles en pestaña Seguridad →
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })()}

        {/* Alerta: Alta actividad de usuario */}
        {stats && stats.highActivityUsers && stats.highActivityUsers.length > 0 && (
          <Card className="border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/20">
            <CardContent className="p-4">
              <div className="flex items-start gap-2">
                <Zap className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                    Actividad inusual detectada
                  </p>
                  <div className="text-sm text-muted-foreground mt-1 space-y-0.5">
                    {stats.highActivityUsers.map((u) => (
                      <p key={u.userId}>
                        <span className="font-medium">{u.email || u.userId.slice(0, 8)}</span>
                        {" "}realizó {u.count} acciones en la última hora
                        {" "}(umbral: {stats.alertConfig?.user_activity_threshold ?? 100})
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ============================================================ */}
        {/* KPI CARDS                                                    */}
        {/* ============================================================ */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Total</span>
                </div>
                <p className="text-2xl font-bold mt-1">
                  {stats.total.toLocaleString()}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-blue-500" />
                  <span className="text-xs text-muted-foreground">Hoy</span>
                </div>
                <p className="text-2xl font-bold mt-1">{stats.today}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-green-500" />
                  <span className="text-xs text-muted-foreground">7 días</span>
                </div>
                <p className="text-2xl font-bold mt-1">
                  {stats.last7Days.toLocaleString()}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-purple-500" />
                  <span className="text-xs text-muted-foreground">30 días</span>
                </div>
                <p className="text-2xl font-bold mt-1">
                  {stats.last30Days.toLocaleString()}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-2">
                  <LogIn className="h-4 w-4 text-green-500" />
                  <span className="text-xs text-muted-foreground">
                    Logins (7d)
                  </span>
                </div>
                <p className="text-2xl font-bold mt-1">
                  {stats.loginsSuccess7Days}
                </p>
              </CardContent>
            </Card>
            <Card
              className={
                stats.loginsFailed7Days > 0
                  ? "border-destructive/50 bg-destructive/5"
                  : ""
              }
            >
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle
                    className={`h-4 w-4 ${stats.loginsFailed7Days > 0 ? "text-destructive" : "text-muted-foreground"}`}
                  />
                  <span className="text-xs text-muted-foreground">
                    Fallidos (7d)
                  </span>
                </div>
                <p
                  className={`text-2xl font-bold mt-1 ${stats.loginsFailed7Days > 0 ? "text-destructive" : ""}`}
                >
                  {stats.loginsFailed7Days}
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ============================================================ */}
        {/* GRÁFICO DE ACTIVIDAD TEMPORAL                                */}
        {/* ============================================================ */}
        {stats && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" />
                  Distribución de Actividad
                </CardTitle>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant={chartView === "hourly" ? "default" : "outline"}
                    onClick={() => setChartView("hourly")}
                    className="text-xs h-7 px-2"
                  >
                    Últimas 24h
                  </Button>
                  <Button
                    size="sm"
                    variant={chartView === "daily" ? "default" : "outline"}
                    onClick={() => setChartView("daily")}
                    className="text-xs h-7 px-2"
                  >
                    Últimos 30d
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={160}>
                {chartView === "hourly" ? (
                  <BarChart data={hourlyData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                    <XAxis
                      dataKey="hour"
                      tick={{ fontSize: 10 }}
                      className="fill-muted-foreground"
                      interval={2}
                    />
                    <YAxis tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                    <RechartsTooltip content={<HourlyTooltip />} />
                    <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                      {hourlyData.map((entry, index) => (
                        <Cell
                          key={index}
                          className={entry.count > (stats.today / 24) * 3 ? "fill-amber-500" : "fill-primary"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                ) : (
                  <BarChart data={dailyData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10 }}
                      className="fill-muted-foreground"
                      interval="preserveStartEnd"
                    />
                    <YAxis tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                    <RechartsTooltip content={<DailyTooltip />} />
                    <Bar dataKey="count" className="fill-primary" radius={[2, 2, 0, 0]} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* ============================================================ */}
        {/* DISTRIBUCIONES + TOP USUARIOS + RETENCIÓN                    */}
        {/* ============================================================ */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Top acciones */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">
                  Top Acciones (30d)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {Object.entries(stats.actionDistribution)
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 8)
                  .map(([action, count]) => (
                    <div
                      key={action}
                      className="flex items-center justify-between"
                    >
                      <Badge
                        variant={ACTION_VARIANTS[action] || "secondary"}
                        className="text-xs"
                      >
                        {ACTION_LABELS[action] || action}
                      </Badge>
                      <span className="text-sm font-medium">{count}</span>
                    </div>
                  ))}
              </CardContent>
            </Card>

            {/* Top entidades */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">
                  Top Entidades (30d)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {Object.entries(stats.entityDistribution)
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 8)
                  .map(([entity, count]) => (
                    <div
                      key={entity}
                      className="flex items-center justify-between"
                    >
                      <span className="text-sm">
                        {ENTITY_LABELS[entity] || entity}
                      </span>
                      <span className="text-sm font-medium">{count}</span>
                    </div>
                  ))}
              </CardContent>
            </Card>

            {/* Top usuarios */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                  <Users className="h-4 w-4" />
                  Usuarios Más Activos (30d)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {stats.topUsers.slice(0, 8).map((user, i) => {
                  const threshold = stats.alertConfig?.user_activity_threshold ?? 100
                  const isAboveThreshold = user.actionCount > threshold * 24
                  return (
                    <div key={user.userId} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-4">
                          {i + 1}.
                        </span>
                        <span className="text-sm truncate max-w-[140px]">
                          {user.email || user.userId.slice(0, 8)}
                        </span>
                        {isAboveThreshold && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Zap className="h-3.5 w-3.5 text-amber-500" />
                            </TooltipTrigger>
                            <TooltipContent>
                              Actividad por encima del umbral mensual
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                      <span className={`text-sm font-medium ${isAboveThreshold ? "text-amber-600 dark:text-amber-400" : ""}`}>
                        {user.actionCount}
                      </span>
                    </div>
                  )
                })}
                {stats.topUsers.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Sin datos aún
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Retención y almacenamiento */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                  <Database className="h-4 w-4" />
                  Retención y Almacenamiento
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {retentionInfo ? (
                  <>
                    <div>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-muted-foreground">Registros totales</span>
                        <span className="font-medium">{retentionInfo.totalRows.toLocaleString()}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-muted-foreground">Antigüedad</span>
                        <span className="font-medium">{retentionInfo.ageInDays}d</span>
                      </div>
                      <div className="flex items-center justify-between text-sm mb-2">
                        <span className="text-muted-foreground">Política</span>
                        <span className="font-medium">{retentionInfo.retentionDays}d en caliente</span>
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-muted-foreground">Uso de ventana de retención</span>
                        <span className="font-medium">{retentionInfo.usagePercent}%</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            retentionInfo.usagePercent > 90 ? "bg-red-500" :
                            retentionInfo.usagePercent > 70 ? "bg-amber-500" : "bg-green-500"
                          }`}
                          style={{ width: `${retentionInfo.usagePercent}%` }}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Logs con más de {retentionInfo.retentionDays} días pueden archivarse.
                      Configurar en{" "}
                      <button
                        className="underline hover:text-foreground"
                        onClick={() => setShowAlertConfig(true)}
                      >
                        ajustes
                      </button>.
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Sin datos de almacenamiento
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ============================================================ */}
        {/* TABS + TABLE                                                 */}
        {/* ============================================================ */}
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <TabsList>
              <TabsTrigger value="all" className="gap-1.5">
                <FileText className="h-4 w-4" />
                Todos
                {stats ? <span className="text-xs opacity-60 ml-1">({stats.total.toLocaleString()})</span> : null}
              </TabsTrigger>
              <TabsTrigger value="security" className="gap-1.5">
                <Shield className="h-4 w-4" />
                Seguridad
              </TabsTrigger>
              <TabsTrigger value="superadmin" className="gap-1.5">
                <Settings className="h-4 w-4" />
                Superadmin
              </TabsTrigger>
            </TabsList>

            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={exporting}
              className="gap-1.5"
            >
              <Download className="h-4 w-4" />
              {exporting ? "Exportando..." : `Exportar CSV${hasFilters ? " (filtrado)" : ""}`}
            </Button>
          </div>

          {/* Filters */}
          <Card className="mt-4">
            <CardHeader className="pb-3">
              <div className="flex flex-col lg:flex-row gap-3">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar por usuario, email, org, IP..."
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <Select
                  value={actionFilter || "all"}
                  onValueChange={(value) => {
                    setActionFilter(value === "all" ? "" : value)
                    setPage(1)
                  }}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Todas las acciones" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas las acciones</SelectItem>
                    {getActionsForTab().map((a) => (
                      <SelectItem key={a.value} value={a.value}>
                        {a.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={entityFilter || "all"}
                  onValueChange={(value) => {
                    setEntityFilter(value === "all" ? "" : value)
                    setPage(1)
                  }}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Todas las entidades" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas las entidades</SelectItem>
                    {Object.entries(ENTITY_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {organizations.length > 0 && (
                  <Select
                    value={orgFilter || "all"}
                    onValueChange={(value) => {
                      setOrgFilter(value === "all" ? "" : value)
                      setPage(1)
                    }}
                  >
                    <SelectTrigger className="w-[200px]">
                      <SelectValue placeholder="Todas las orgs" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas las orgs</SelectItem>
                      {organizations.map((org) => (
                        <SelectItem key={org.id} value={org.id}>
                          {org.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground whitespace-nowrap">
                    Desde:
                  </span>
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => {
                      setDateFrom(e.target.value)
                      setPage(1)
                    }}
                    className="w-[160px]"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground whitespace-nowrap">
                    Hasta:
                  </span>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => {
                      setDateTo(e.target.value)
                      setPage(1)
                    }}
                    className="w-[160px]"
                  />
                </div>
                {hasFilters && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setDateFrom("")
                      setDateTo("")
                      setActionFilter("")
                      setEntityFilter("")
                      setOrgFilter("")
                      setSearchInput("")
                      setSearchQuery("")
                      setPage(1)
                    }}
                  >
                    Limpiar filtros
                  </Button>
                )}
              </div>
            </CardHeader>

            <CardContent>
              {/* Paginación info */}
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-muted-foreground">
                  Mostrando {Math.min((page - 1) * PAGE_SIZE + 1, total)}-{Math.min(page * PAGE_SIZE, total)} de {total.toLocaleString()} registros
                  {hasFilters && " (filtrado)"}
                </p>
              </div>

              <TabsContent value="all" className="mt-0">
                <DataTable
                  data={logs}
                  columns={columns}
                  keyExtractor={(log) => log.id}
                  loading={loading}
                  emptyMessage="No se encontraron logs"
                  expandedKeys={expandedRows}
                  renderExpandedRow={renderExpandedRow}
                  pagination={{
                    page,
                    pageSize: PAGE_SIZE,
                    total,
                    onPageChange: setPage,
                  }}
                />
              </TabsContent>

              <TabsContent value="security" className="mt-0">
                {/* Security events recientes */}
                {stats && stats.securityEvents.length > 0 && (
                  <div className="mb-4">
                    <h3 className="text-sm font-medium mb-2">Últimos eventos de seguridad</h3>
                    <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                      {stats.securityEvents.map((event) => (
                        <div
                          key={event.id}
                          className="flex items-center gap-3 text-xs p-2 rounded bg-muted/40"
                        >
                          <Badge
                            variant={ACTION_VARIANTS[event.action] || "secondary"}
                            className="text-[10px] px-1.5 py-0"
                          >
                            {ACTION_LABELS[event.action] || event.action}
                          </Badge>
                          <span className="text-muted-foreground truncate max-w-[180px]">
                            {event.email || "Desconocido"}
                          </span>
                          {event.description && (
                            <span className="text-muted-foreground truncate max-w-[200px] hidden md:inline">
                              {event.description}
                            </span>
                          )}
                          {event.ipAddress && (
                            <span className="font-mono text-muted-foreground">
                              {event.ipAddress}
                            </span>
                          )}
                          <span className="text-muted-foreground ml-auto whitespace-nowrap">
                            {formatDateTime(event.createdAt)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <DataTable
                  data={logs}
                  columns={columns}
                  keyExtractor={(log) => log.id}
                  loading={loading}
                  emptyMessage="No se encontraron eventos de seguridad"
                  expandedKeys={expandedRows}
                  renderExpandedRow={renderExpandedRow}
                  pagination={{
                    page,
                    pageSize: PAGE_SIZE,
                    total,
                    onPageChange: setPage,
                  }}
                />
              </TabsContent>

              <TabsContent value="superadmin" className="mt-0">
                <DataTable
                  data={logs}
                  columns={columns}
                  keyExtractor={(log) => log.id}
                  loading={loading}
                  emptyMessage="No se encontraron acciones de superadmin"
                  expandedKeys={expandedRows}
                  renderExpandedRow={renderExpandedRow}
                  pagination={{
                    page,
                    pageSize: PAGE_SIZE,
                    total,
                    onPageChange: setPage,
                  }}
                />
              </TabsContent>
            </CardContent>
          </Card>
        </Tabs>

        {/* ============================================================ */}
        {/* MODAL: Configurar Alertas                                    */}
        {/* ============================================================ */}
        <Dialog open={showAlertConfig} onOpenChange={setShowAlertConfig}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sliders className="h-5 w-5" />
                Configuración de Alertas y Retención
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-5 py-2">
              <div>
                <h4 className="text-sm font-medium mb-3">Alertas de actividad por usuario</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Umbral de eventos</Label>
                    <Input
                      type="number"
                      min={10}
                      max={10000}
                      value={alertForm.user_activity_threshold}
                      onChange={(e) => setAlertForm(f => ({ ...f, user_activity_threshold: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Ventana (horas)</Label>
                    <Input
                      type="number"
                      min={1}
                      max={168}
                      value={alertForm.user_activity_window_hours}
                      onChange={(e) => setAlertForm(f => ({ ...f, user_activity_window_hours: e.target.value }))}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  Alerta cuando un usuario supere {alertForm.user_activity_threshold} eventos en {alertForm.user_activity_window_hours}h.
                </p>
              </div>

              <div>
                <h4 className="text-sm font-medium mb-3">Alertas de logins fallidos</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Umbral de intentos</Label>
                    <Input
                      type="number"
                      min={1}
                      max={1000}
                      value={alertForm.failed_login_threshold}
                      onChange={(e) => setAlertForm(f => ({ ...f, failed_login_threshold: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Ventana (horas)</Label>
                    <Input
                      type="number"
                      min={1}
                      max={168}
                      value={alertForm.failed_login_window_hours}
                      onChange={(e) => setAlertForm(f => ({ ...f, failed_login_window_hours: e.target.value }))}
                    />
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-medium mb-3">Política de retención</h4>
                <div className="space-y-1.5">
                  <Label className="text-xs">Días en caliente</Label>
                  <Input
                    type="number"
                    min={30}
                    max={365}
                    value={alertForm.retention_days}
                    onChange={(e) => setAlertForm(f => ({ ...f, retention_days: e.target.value }))}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  Los logs con más de {alertForm.retention_days} días pueden ser archivados o eliminados.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAlertConfig(false)}>Cancelar</Button>
              <Button onClick={handleSaveAlertConfig} disabled={saving}>
                {saving ? "Guardando..." : "Guardar configuración"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  )
}
