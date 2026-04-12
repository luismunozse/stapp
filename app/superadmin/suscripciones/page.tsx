"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { DataTable, Column } from "@/components/ui/data-table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  CreditCard,
  Eye,
  Download,
  Search,
  MoreHorizontal,
  Clock,
  XCircle,
  RefreshCw,
  Zap,
  History,
  CheckCircle,
  Loader2,
  AlertTriangle,
  Activity,
  Settings2,
} from "lucide-react"
import { formatDate } from "@/lib/utils"
import { useSuperadminFetch, useSuperadminMutation } from "@/hooks/use-superadmin-fetch"
import { useLastUpdated } from "@/hooks/use-last-updated"
import { LastUpdated } from "@/components/superadmin/last-updated"
import type { SubscriptionListItem } from "@/types/superadmin"
import { getEffectivePlanLabel, isEffectivelyPremium, isTrialExpired } from "@/lib/subscription-status"
import { toast } from "sonner"

const PAGE_SIZE = 20

interface ExtendedSubscriptionItem extends SubscriptionListItem {
  hasRecentActivity?: boolean
}

interface SubsResponse {
  subscriptions: ExtendedSubscriptionItem[]
  total: number
  counts: {
    active: number
    trialing: number
    expiredTrials: number
    canceled: number
    past_due?: number
  }
}

interface HistoryEntry {
  id: string
  action: string
  previous_status: string | null
  new_status: string | null
  details: Record<string, unknown> | null
  performed_by: string | null
  created_at: string
}

export default function SuscripcionesPage() {
  const router = useRouter()
  const [subscriptions, setSubscriptions] = useState<ExtendedSubscriptionItem[]>([])
  const [statusFilter, setStatusFilter] = useState("")
  const [planFilter, setPlanFilter] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [searchInput, setSearchInput] = useState("")
  const [sortBy, setSortBy] = useState("created_at")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState({ active: 0, trialing: 0, expiredTrials: 0, canceled: 0 })

  // Seleccion bulk
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Modales
  const [cancelModal, setCancelModal] = useState<{ open: boolean; orgId: string; orgName: string }>({ open: false, orgId: "", orgName: "" })
  const [extendModal, setExtendModal] = useState<{ open: boolean; orgId: string; orgName: string }>({ open: false, orgId: "", orgName: "" })
  const [renewModal, setRenewModal] = useState<{ open: boolean; orgId: string; orgName: string }>({ open: false, orgId: "", orgName: "" })
  const [historyModal, setHistoryModal] = useState<{ open: boolean; orgId: string; orgName: string }>({ open: false, orgId: "", orgName: "" })
  const [limitsModal, setLimitsModal] = useState<{ open: boolean; orgId: string; orgName: string }>({ open: false, orgId: "", orgName: "" })
  const [bulkModal, setBulkModal] = useState<{ open: boolean; action: string }>({ open: false, action: "" })

  // Form states
  const [cancelImmediate, setCancelImmediate] = useState(false)
  const [extendDias, setExtendDias] = useState(7)
  const [extendMotivo, setExtendMotivo] = useState("")
  const [renewPeriod, setRenewPeriod] = useState<"MONTHLY" | "YEARLY">("MONTHLY")
  const [renewCustomDate, setRenewCustomDate] = useState("")
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([])
  const [limitOverrides, setLimitOverrides] = useState({ limite_ordenes: "", limite_tecnicos: "", limite_clientes: "", limite_storage_mb: "", motivo: "" })
  const [bulkDias, setBulkDias] = useState(7)
  const [bulkMotivo, setBulkMotivo] = useState("")
  const [bulkPeriod, setBulkPeriod] = useState<"MONTHLY" | "YEARLY">("MONTHLY")

  const { loading, fetchData } = useSuperadminFetch<SubsResponse>()
  const { mutate, loading: mutating } = useSuperadminMutation()
  const { formattedLastUpdated, markUpdated } = useLastUpdated()

  const fetchSubscriptions = useCallback(async () => {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: PAGE_SIZE.toString(),
      sortBy,
      sortDir,
      ...(statusFilter && { status: statusFilter }),
      ...(planFilter && { plan: planFilter }),
      ...(dateFrom && { dateFrom }),
      ...(dateTo && { dateTo }),
      ...(searchQuery && { search: searchQuery }),
    })

    const result = await fetchData(`/api/superadmin/subscriptions?${params}`)
    if (result) {
      setSubscriptions(result.subscriptions || [])
      setTotal(result.total || 0)
      if (result.counts) setCounts(result.counts)
      markUpdated()
    }
  }, [page, statusFilter, planFilter, dateFrom, dateTo, searchQuery, sortBy, sortDir, fetchData])

  useEffect(() => {
    fetchSubscriptions()
  }, [fetchSubscriptions])

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(searchInput)
      setPage(1)
    }, 400)
    return () => clearTimeout(timer)
  }, [searchInput])

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortDir(sortDir === "asc" ? "desc" : "asc")
    } else {
      setSortBy(column)
      setSortDir("desc")
    }
    setPage(1)
  }

  const toggleSelect = (orgId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(orgId)) next.delete(orgId)
      else next.add(orgId)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === subscriptions.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(subscriptions.map((s) => s.organization?.id).filter(Boolean)))
    }
  }

  // === Acciones ===

  const handleCancel = async () => {
    await mutate("/api/superadmin/subscriptions/cancel", {
      method: "POST",
      body: { organizationId: cancelModal.orgId, immediate: cancelImmediate },
      successMessage: "Suscripción cancelada",
      onSuccess: () => {
        setCancelModal({ open: false, orgId: "", orgName: "" })
        setCancelImmediate(false)
        fetchSubscriptions()
      },
    })
  }

  const handleExtendTrial = async () => {
    await mutate("/api/superadmin/trial-extension", {
      method: "POST",
      body: { organizationId: extendModal.orgId, dias: extendDias, motivo: extendMotivo || undefined },
      successMessage: "Trial extendido",
      onSuccess: () => {
        setExtendModal({ open: false, orgId: "", orgName: "" })
        setExtendDias(7)
        setExtendMotivo("")
        fetchSubscriptions()
      },
    })
  }

  const handleRenew = async () => {
    await mutate("/api/superadmin/subscriptions/renew", {
      method: "POST",
      body: {
        organizationId: renewModal.orgId,
        billingPeriod: renewPeriod,
        ...(renewCustomDate && { customEndDate: new Date(renewCustomDate).toISOString() }),
      },
      successMessage: "Suscripción activada",
      onSuccess: () => {
        setRenewModal({ open: false, orgId: "", orgName: "" })
        setRenewCustomDate("")
        fetchSubscriptions()
      },
    })
  }

  const handleFetchHistory = async (orgId: string) => {
    const res = await fetch(`/api/superadmin/subscriptions/history?organizationId=${orgId}`)
    const data = await res.json()
    setHistoryEntries(data.history || [])
  }

  const handleSaveLimits = async () => {
    const body: Record<string, unknown> = { organizationId: limitsModal.orgId }
    if (limitOverrides.limite_ordenes) body.limite_ordenes = parseInt(limitOverrides.limite_ordenes)
    if (limitOverrides.limite_tecnicos) body.limite_tecnicos = parseInt(limitOverrides.limite_tecnicos)
    if (limitOverrides.limite_clientes) body.limite_clientes = parseInt(limitOverrides.limite_clientes)
    if (limitOverrides.limite_storage_mb) body.limite_storage_mb = parseInt(limitOverrides.limite_storage_mb)
    if (limitOverrides.motivo) body.motivo = limitOverrides.motivo

    await mutate("/api/superadmin/subscriptions/limit-overrides", {
      method: "POST",
      body,
      successMessage: "Límites actualizados",
      onSuccess: () => {
        setLimitsModal({ open: false, orgId: "", orgName: "" })
        setLimitOverrides({ limite_ordenes: "", limite_tecnicos: "", limite_clientes: "", limite_storage_mb: "", motivo: "" })
      },
    })
  }

  const handleBulkAction = async () => {
    const orgIds = Array.from(selectedIds)
    const body: Record<string, unknown> = { organizationIds: orgIds, action: bulkModal.action }

    if (bulkModal.action === "extend_trial") {
      body.dias = bulkDias
      body.motivo = bulkMotivo || undefined
    } else if (bulkModal.action === "activate") {
      body.billingPeriod = bulkPeriod
    } else if (bulkModal.action === "cancel") {
      body.immediate = true
    }

    await mutate("/api/superadmin/subscriptions/bulk", {
      method: "POST",
      body,
      successMessage: "Acción masiva completada",
      onSuccess: () => {
        setBulkModal({ open: false, action: "" })
        setSelectedIds(new Set())
        setBulkDias(7)
        setBulkMotivo("")
        fetchSubscriptions()
      },
    })
  }

  const handleExportCSV = () => {
    const csv = [
      "organizacion,slug,plan,estado,proveedor_pago,periodo,vence_trial,vence_periodo,cancelacion_pendiente,actividad_reciente,creado",
      ...subscriptions.map((sub) =>
        [
          `"${sub.organization?.nombre || "-"}"`,
          sub.organization?.slug || "-",
          getEffectivePlanLabel(sub),
          sub.status,
          sub.payment_provider || "-",
          sub.billing_period || "-",
          sub.trial_end || "-",
          sub.current_period_end || "-",
          sub.cancel_at_period_end ? "Si" : "No",
          sub.hasRecentActivity ? "Si" : "No",
          sub.created_at?.split("T")[0] || "-",
        ].join(",")
      ),
    ].join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `suscripciones-${new Date().toISOString().split("T")[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const getStatusBadge = (sub: ExtendedSubscriptionItem) => {
    const now = new Date()
    switch (sub.status) {
      case "ACTIVE":
        return <Badge variant="default">Activa</Badge>
      case "TRIALING": {
        if (sub.trial_end) {
          const trialEnd = new Date(sub.trial_end)
          const daysLeft = Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
          if (daysLeft <= 0) return <Badge variant="destructive">Trial vencido</Badge>
          if (daysLeft <= 3) return <Badge variant="destructive">Trial · {daysLeft}d</Badge>
          if (daysLeft <= 7) return <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200">Trial · {daysLeft}d</Badge>
          return <Badge variant="secondary">Trial · {daysLeft}d</Badge>
        }
        return <Badge variant="secondary">Trial</Badge>
      }
      case "PAST_DUE":
        return <Badge variant="destructive">Pago pendiente</Badge>
      case "CANCELED":
        return <Badge variant="destructive">Cancelada</Badge>
      default:
        return <Badge variant="secondary">{sub.status}</Badge>
    }
  }

  const getVencimiento = (sub: ExtendedSubscriptionItem) => {
    if (sub.status === "TRIALING" && sub.trial_end) return formatDate(sub.trial_end)
    if (sub.current_period_end) return formatDate(sub.current_period_end)
    return "-"
  }

  const columns: Column<ExtendedSubscriptionItem>[] = [
    {
      key: "select",
      header: "",
      render: (sub) => (
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-gray-300"
          checked={selectedIds.has(sub.organization?.id)}
          onChange={() => toggleSelect(sub.organization?.id)}
        />
      ),
    },
    {
      key: "organization",
      header: "Organización",
      render: (sub) => (
        <div className="flex items-center gap-2">
          <div>
            <div className="font-medium">{sub.organization?.nombre || "-"}</div>
            <div className="text-sm text-muted-foreground">{sub.organization?.slug}.stapp.com.ar</div>
          </div>
          {sub.hasRecentActivity === false && sub.status !== "CANCELED" && (
            <span title="Sin actividad en 7+ días" className="text-amber-500">
              <AlertTriangle className="h-3.5 w-3.5" />
            </span>
          )}
          {sub.hasRecentActivity === true && (
            <span title="Activa en últimos 7 días" className="text-green-500">
              <Activity className="h-3.5 w-3.5" />
            </span>
          )}
        </div>
      ),
    },
    {
      key: "plans",
      header: "Plan",
      render: (sub) => (
        <Badge variant={isEffectivelyPremium(sub) ? "default" : isTrialExpired(sub) ? "destructive" : "secondary"}>
          {getEffectivePlanLabel(sub)}
        </Badge>
      ),
    },
    {
      key: "status",
      header: "Estado",
      render: (sub) => (
        <div className="flex items-center gap-1.5">
          {getStatusBadge(sub)}
          {sub.cancel_at_period_end && <Badge variant="outline" className="text-xs">Cancela pronto</Badge>}
        </div>
      ),
    },
    {
      key: "payment_provider",
      header: "Pago",
      hideOnMobile: true,
      render: (sub) => {
        if (!sub.payment_provider) return <span className="text-muted-foreground">-</span>
        const labels: Record<string, string> = { MERCADOPAGO: "MercadoPago", REBILL: "Rebill (USD)" }
        return <span className="text-sm">{labels[sub.payment_provider] || sub.payment_provider}</span>
      },
    },
    {
      key: "vencimiento",
      header: "Vence",
      render: (sub) => {
        const text = getVencimiento(sub)
        if (text === "-") return <span className="text-muted-foreground">-</span>
        const now = new Date()
        const dateStr = sub.status === "TRIALING" ? sub.trial_end : sub.current_period_end
        if (dateStr) {
          const date = new Date(dateStr)
          const daysLeft = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
          if (daysLeft <= 0) return <span className="text-red-600 font-medium">{text}</span>
          if (daysLeft <= 3) return <span className="text-red-500">{text}</span>
          if (daysLeft <= 7) return <span className="text-amber-600">{text}</span>
        }
        return text
      },
    },
    {
      key: "actions",
      header: "",
      render: (sub) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost"><MoreHorizontal className="h-4 w-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => router.push(`/superadmin/organizaciones/${sub.organization?.id}`)}>
              <Eye className="h-4 w-4 mr-2" /> Ver organización
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {(sub.status === "TRIALING" || sub.status === "CANCELED") && (
              <DropdownMenuItem onClick={() => setExtendModal({ open: true, orgId: sub.organization?.id, orgName: sub.organization?.nombre })}>
                <Clock className="h-4 w-4 mr-2" /> Extender trial
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => setRenewModal({ open: true, orgId: sub.organization?.id, orgName: sub.organization?.nombre })}>
              <RefreshCw className="h-4 w-4 mr-2" /> {sub.status === "ACTIVE" ? "Extender suscripción" : "Activar Premium"}
            </DropdownMenuItem>
            {sub.status !== "CANCELED" && (
              <DropdownMenuItem
                className="text-red-600"
                onClick={() => setCancelModal({ open: true, orgId: sub.organization?.id, orgName: sub.organization?.nombre })}
              >
                <XCircle className="h-4 w-4 mr-2" /> Cancelar suscripción
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => {
              setHistoryModal({ open: true, orgId: sub.organization?.id, orgName: sub.organization?.nombre })
              handleFetchHistory(sub.organization?.id)
            }}>
              <History className="h-4 w-4 mr-2" /> Ver historial
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setLimitsModal({ open: true, orgId: sub.organization?.id, orgName: sub.organization?.nombre })}>
              <Settings2 className="h-4 w-4 mr-2" /> Override límites
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <CreditCard className="h-8 w-8" />
            Suscripciones
          </h1>
          <p className="text-muted-foreground">Gestiona todas las suscripciones del sistema</p>
          <LastUpdated formattedLastUpdated={formattedLastUpdated} onRefresh={fetchSubscriptions} loading={loading} />
        </div>
        <Button variant="outline" onClick={handleExportCSV} disabled={subscriptions.length === 0}>
          <Download className="h-4 w-4 mr-2" /> Exportar CSV
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Activas</p><p className="text-2xl font-bold text-green-600">{counts.active}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">En trial</p><p className="text-2xl font-bold text-blue-600">{counts.trialing}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Trials vencidos</p><p className="text-2xl font-bold text-red-600">{counts.expiredTrials}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Canceladas</p><p className="text-2xl font-bold text-amber-600">{counts.canceled}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Total</p><p className="text-2xl font-bold">{counts.active + counts.trialing + counts.expiredTrials + counts.canceled}</p></CardContent></Card>
      </div>

      {/* Bulk actions bar */}
      {selectedIds.size > 0 && (
        <Card>
          <CardContent className="p-3 flex items-center gap-3">
            <span className="text-sm font-medium">{selectedIds.size} seleccionadas</span>
            <Button size="sm" variant="outline" onClick={() => setBulkModal({ open: true, action: "extend_trial" })}>
              <Clock className="h-4 w-4 mr-1" /> Extender trials
            </Button>
            <Button size="sm" variant="outline" onClick={() => setBulkModal({ open: true, action: "activate" })}>
              <Zap className="h-4 w-4 mr-1" /> Activar Premium
            </Button>
            <Button size="sm" variant="outline" className="text-red-600" onClick={() => setBulkModal({ open: true, action: "cancel" })}>
              <XCircle className="h-4 w-4 mr-1" /> Cancelar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>Deseleccionar</Button>
          </CardContent>
        </Card>
      )}

      {/* Filters + Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar organización..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-9 w-[250px]"
              />
            </div>
            <Select value={statusFilter || "all"} onValueChange={(v) => { setStatusFilter(v === "all" ? "" : v); setPage(1) }}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Todos los estados" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                <SelectItem value="active">Activas</SelectItem>
                <SelectItem value="trialing">En prueba</SelectItem>
                <SelectItem value="past_due">Pago pendiente</SelectItem>
                <SelectItem value="canceled">Canceladas</SelectItem>
              </SelectContent>
            </Select>
            <Select value={planFilter || "all"} onValueChange={(v) => { setPlanFilter(v === "all" ? "" : v); setPage(1) }}>
              <SelectTrigger className="w-[150px]"><SelectValue placeholder="Todos los planes" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los planes</SelectItem>
                <SelectItem value="free">Free</SelectItem>
                <SelectItem value="premium">Premium</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground whitespace-nowrap">Desde:</span>
              <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1) }} className="w-[160px]" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground whitespace-nowrap">Hasta:</span>
              <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1) }} className="w-[160px]" />
            </div>
            {(dateFrom || dateTo || statusFilter || planFilter || searchQuery) && (
              <Button variant="ghost" onClick={() => { setDateFrom(""); setDateTo(""); setStatusFilter(""); setPlanFilter(""); setSearchInput(""); setSearchQuery(""); setPage(1) }}>
                Limpiar filtros
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            data={subscriptions}
            columns={columns}
            keyExtractor={(sub) => sub.id}
            loading={loading}
            emptyMessage="No se encontraron suscripciones"
            pagination={{ page, pageSize: PAGE_SIZE, total, onPageChange: setPage }}
          />
        </CardContent>
      </Card>

      {/* === MODALES === */}

      {/* Modal: Cancelar */}
      <Dialog open={cancelModal.open} onOpenChange={(open) => setCancelModal((p) => ({ ...p, open }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancelar suscripción</DialogTitle>
            <DialogDescription>Cancelar la suscripción de {cancelModal.orgName}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted">
              <input type="checkbox" className="h-4 w-4 rounded" checked={cancelImmediate} onChange={(e) => setCancelImmediate(e.target.checked)} id="immediate" />
              <div>
                <Label htmlFor="immediate" className="font-medium">Cancelación inmediata</Label>
                <p className="text-sm text-muted-foreground">Si no se marca, se cancelará al final del período actual</p>
              </div>
            </div>
            {cancelImmediate && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 text-sm">
                La organización perderá acceso Premium inmediatamente.
              </div>
            )}
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setCancelModal({ open: false, orgId: "", orgName: "" })} disabled={mutating}>Volver</Button>
              <Button variant="destructive" onClick={handleCancel} disabled={mutating}>
                {mutating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <XCircle className="h-4 w-4 mr-2" />}
                Cancelar suscripción
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal: Extender trial */}
      <Dialog open={extendModal.open} onOpenChange={(open) => setExtendModal((p) => ({ ...p, open }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Extender trial</DialogTitle>
            <DialogDescription>Extender el período de prueba de {extendModal.orgName}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Días a extender</Label>
              <Input type="number" min={1} max={90} value={extendDias} onChange={(e) => setExtendDias(parseInt(e.target.value) || 7)} />
            </div>
            <div className="space-y-2">
              <Label>Motivo (opcional)</Label>
              <Textarea value={extendMotivo} onChange={(e) => setExtendMotivo(e.target.value)} placeholder="Ej: Usuario pidió más tiempo para evaluar" rows={2} />
            </div>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setExtendModal({ open: false, orgId: "", orgName: "" })} disabled={mutating}>Cancelar</Button>
              <Button onClick={handleExtendTrial} disabled={mutating}>
                {mutating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Clock className="h-4 w-4 mr-2" />}
                Extender {extendDias} días
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal: Renovar / Activar */}
      <Dialog open={renewModal.open} onOpenChange={(open) => setRenewModal((p) => ({ ...p, open }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Activar / Renovar Premium</DialogTitle>
            <DialogDescription>{renewModal.orgName}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Período de facturación</Label>
              <Select value={renewPeriod} onValueChange={(v) => setRenewPeriod(v as "MONTHLY" | "YEARLY")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MONTHLY">Mensual (1 mes)</SelectItem>
                  <SelectItem value="YEARLY">Anual (12 meses)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>O fecha de fin personalizada</Label>
              <Input type="date" value={renewCustomDate} onChange={(e) => setRenewCustomDate(e.target.value)} min={new Date().toISOString().split("T")[0]} />
              {renewCustomDate && <p className="text-xs text-muted-foreground">La fecha personalizada tiene prioridad sobre el período</p>}
            </div>
            <div className="p-3 rounded-lg bg-muted text-sm text-muted-foreground">
              Se activará sin proceso de pago. El admin de la org será notificado.
            </div>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => { setRenewModal({ open: false, orgId: "", orgName: "" }); setRenewCustomDate("") }} disabled={mutating}>Cancelar</Button>
              <Button onClick={handleRenew} disabled={mutating}>
                {mutating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                Activar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal: Historial */}
      <Dialog open={historyModal.open} onOpenChange={(open) => setHistoryModal((p) => ({ ...p, open }))}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Historial de suscripción</DialogTitle>
            <DialogDescription>{historyModal.orgName}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {historyEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Sin historial registrado</p>
            ) : (
              historyEntries.map((entry) => (
                <div key={entry.id} className="border rounded-lg p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline">{entry.action}</Badge>
                    <span className="text-xs text-muted-foreground">{formatDate(entry.created_at)}</span>
                  </div>
                  {entry.previous_status && entry.new_status && (
                    <p className="text-sm">{entry.previous_status} → {entry.new_status}</p>
                  )}
                  {entry.performed_by && <p className="text-xs text-muted-foreground">Por: {entry.performed_by}</p>}
                  {entry.details && (
                    <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">{JSON.stringify(entry.details, null, 2)}</pre>
                  )}
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal: Override límites */}
      <Dialog open={limitsModal.open} onOpenChange={(open) => setLimitsModal((p) => ({ ...p, open }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Límites personalizados</DialogTitle>
            <DialogDescription>Override de límites del plan para {limitsModal.orgName}. Dejar vacío para usar los del plan.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Órdenes/mes</Label>
                <Input type="number" placeholder="Plan default" value={limitOverrides.limite_ordenes} onChange={(e) => setLimitOverrides((p) => ({ ...p, limite_ordenes: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Técnicos</Label>
                <Input type="number" placeholder="Plan default" value={limitOverrides.limite_tecnicos} onChange={(e) => setLimitOverrides((p) => ({ ...p, limite_tecnicos: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Clientes</Label>
                <Input type="number" placeholder="Plan default" value={limitOverrides.limite_clientes} onChange={(e) => setLimitOverrides((p) => ({ ...p, limite_clientes: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Storage (MB)</Label>
                <Input type="number" placeholder="Plan default" value={limitOverrides.limite_storage_mb} onChange={(e) => setLimitOverrides((p) => ({ ...p, limite_storage_mb: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Motivo</Label>
              <Input placeholder="Ej: Cliente enterprise con necesidades especiales" value={limitOverrides.motivo} onChange={(e) => setLimitOverrides((p) => ({ ...p, motivo: e.target.value }))} />
            </div>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setLimitsModal({ open: false, orgId: "", orgName: "" })} disabled={mutating}>Cancelar</Button>
              <Button onClick={handleSaveLimits} disabled={mutating}>
                {mutating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                Guardar límites
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal: Bulk action */}
      <Dialog open={bulkModal.open} onOpenChange={(open) => setBulkModal((p) => ({ ...p, open }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Acción masiva: {bulkModal.action === "extend_trial" ? "Extender trials" : bulkModal.action === "activate" ? "Activar Premium" : "Cancelar"}
            </DialogTitle>
            <DialogDescription>{selectedIds.size} organizaciones seleccionadas</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {bulkModal.action === "extend_trial" && (
              <>
                <div className="space-y-2">
                  <Label>Días a extender</Label>
                  <Input type="number" min={1} max={90} value={bulkDias} onChange={(e) => setBulkDias(parseInt(e.target.value) || 7)} />
                </div>
                <div className="space-y-2">
                  <Label>Motivo (opcional)</Label>
                  <Textarea value={bulkMotivo} onChange={(e) => setBulkMotivo(e.target.value)} rows={2} />
                </div>
              </>
            )}
            {bulkModal.action === "activate" && (
              <div className="space-y-2">
                <Label>Período</Label>
                <Select value={bulkPeriod} onValueChange={(v) => setBulkPeriod(v as "MONTHLY" | "YEARLY")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MONTHLY">Mensual</SelectItem>
                    <SelectItem value="YEARLY">Anual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {bulkModal.action === "cancel" && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 text-sm">
                Se cancelarán inmediatamente {selectedIds.size} suscripciones. Esta acción no se puede deshacer.
              </div>
            )}
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setBulkModal({ open: false, action: "" })} disabled={mutating}>Cancelar</Button>
              <Button onClick={handleBulkAction} disabled={mutating} variant={bulkModal.action === "cancel" ? "destructive" : "default"}>
                {mutating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Ejecutar ({selectedIds.size})
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
