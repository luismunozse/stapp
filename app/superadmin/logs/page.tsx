"use client"

import { useState, useEffect, useCallback } from "react"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DataTable, Column } from "@/components/ui/data-table"
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
} from "lucide-react"
import { formatDateTime } from "@/lib/utils"
import { useSuperadminFetch } from "@/hooks/use-superadmin-fetch"
import { useLastUpdated } from "@/hooks/use-last-updated"
import { LastUpdated } from "@/components/superadmin/last-updated"
import type { AuditLogWithRelations } from "@/types/superadmin"

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
  facturas: "Facturas",
  garantias: "Garantías",
  ventas: "Ventas",
  checklist_templates: "Checklists",
  devoluciones_venta: "Devoluciones",
  movimientos_inventario: "Mov. Inventario",
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
}

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

  const { loading, fetchData } = useSuperadminFetch<{
    logs: AuditLogWithRelations[]
    total: number
  }>()
  const { loading: statsLoading, fetchData: fetchStatsData } =
    useSuperadminFetch<AuditStats>()
  const { formattedLastUpdated, markUpdated } = useLastUpdated()

  // Cargar lista de organizaciones para el filtro
  useEffect(() => {
    const loadOrgs = async () => {
      try {
        const superadminEmail = document.cookie
          .split("; ")
          .find((c) => c.startsWith("superadmin_email="))
          ?.split("=")[1]
        const res = await fetch("/api/superadmin/organizations?limit=500", {
          headers: {
            "x-superadmin-panel": "true",
            "x-superadmin-email": superadminEmail || "",
          },
        })
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
        ...(entityFilter && { entity: entityFilter }),
        ...(actionFilter && { action: actionFilter }),
        ...(orgFilter && { organizationId: orgFilter }),
        ...(dateFrom && { dateFrom }),
        ...(dateTo && { dateTo }),
        ...(searchQuery && { search: searchQuery }),
      })

      const superadminEmail = document.cookie
        .split("; ")
        .find((c) => c.startsWith("superadmin_email="))
        ?.split("=")[1]

      const response = await fetch(`/api/superadmin/audit-logs/export?${params}`, {
        headers: {
          "x-superadmin-panel": "true",
          "x-superadmin-email": superadminEmail || "",
        },
      })

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
            Detalles - {ENTITY_LABELS[log.entity] || log.entity} (
            {ACTION_LABELS[log.action] || log.action}) -{" "}
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
        ) : (
          <pre className="text-xs overflow-x-auto p-2 bg-muted rounded">
            {JSON.stringify(displayChanges, null, 2)}
          </pre>
        )}

        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
          {log.ip_address && (
            <span>
              IP: <span className="font-mono">{log.ip_address}</span>
            </span>
          )}
          {log.user_agent && (
            <span className="truncate max-w-[400px]">
              UA: {log.user_agent}
            </span>
          )}
          {log.entity_id && <span>Entity ID: {log.entity_id}</span>}
        </div>
      </div>
    )
  }

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
        return (
          <div className="flex items-center gap-1.5">
            {Icon && <Icon className="h-3.5 w-3.5" />}
            <Badge variant={ACTION_VARIANTS[log.action] || "secondary"}>
              {ACTION_LABELS[log.action] || log.action}
            </Badge>
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
          <span className="text-muted-foreground text-xs">-</span>
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
          <span className="text-muted-foreground text-xs">-</span>
        ),
    },
    {
      key: "ip_address",
      header: "IP",
      hideOnMobile: true,
      render: (log) => (
        <span className="text-xs text-muted-foreground font-mono">
          {log.ip_address || "-"}
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

  // Acciones disponibles por tab
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

  return (
    <div className="space-y-6">
      {/* Header */}
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

      {/* Stats Cards */}
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

      {/* Distribution cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
              {stats.topUsers.slice(0, 8).map((user, i) => (
                <div key={user.userId} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-4">
                      {i + 1}.
                    </span>
                    <span className="text-sm truncate max-w-[180px]">
                      {user.email || user.userId.slice(0, 8)}
                    </span>
                  </div>
                  <span className="text-sm font-medium">
                    {user.actionCount}
                  </span>
                </div>
              ))}
              {stats.topUsers.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Sin datos aún
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabs + Table */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="all" className="gap-1.5">
              <FileText className="h-4 w-4" />
              Todos
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
            {exporting ? "Exportando..." : "Exportar CSV"}
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
              {/* Security alert */}
              {stats && stats.loginsFailed7Days > 5 && (
                <div className="mb-4 p-3 bg-destructive/10 border border-destructive/30 rounded-lg flex items-start gap-2">
                  <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-destructive">
                      Alto número de intentos fallidos
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Se detectaron {stats.loginsFailed7Days} intentos de login
                      fallidos en los últimos 7 días. Revise las IPs de origen.
                    </p>
                  </div>
                </div>
              )}

              {/* Eventos de seguridad recientes */}
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
    </div>
  )
}
