"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DataTable, Column } from "@/components/ui/data-table"
import { Search, Eye, Power, PowerOff, Building2, Loader2, Download, CheckCircle, XCircle, X, Phone, AlertTriangle, Users, CreditCard, CalendarPlus, TrendingUp, ExternalLink, Trash2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatDate } from "@/lib/utils"
import { useSuperadminFetch, useSuperadminMutation } from "@/hooks/use-superadmin-fetch"
import { useLastUpdated } from "@/hooks/use-last-updated"
import { LastUpdated } from "@/components/superadmin/last-updated"
import type { OrganizationListItem, OrganizationsKpis } from "@/types/superadmin"
import { getEffectivePlanLabel, isEffectivelyPremium, isTrialExpired } from "@/lib/subscription-status"

const PAGE_SIZE = 20

interface OrgsResponse {
  organizations: OrganizationListItem[]
  total: number
  kpis?: OrganizationsKpis
}

export default function OrganizacionesPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [organizations, setOrganizations] = useState<OrganizationListItem[]>([])
  const [kpis, setKpis] = useState<OrganizationsKpis | null>(null)
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [adminEmail, setAdminEmail] = useState("")
  const [debouncedAdminEmail, setDebouncedAdminEmail] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [planFilter, setPlanFilter] = useState("")
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [confirmDeactivateOpen, setConfirmDeactivateOpen] = useState(false)
  const [confirmDeleteOrg, setConfirmDeleteOrg] = useState<{ id: string; nombre: string } | null>(null)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debounceAdminEmailRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sorting — persistido en URL query params
  const [sortKey, setSortKey] = useState(searchParams.get("sort") || "")
  const [sortDir, setSortDir] = useState<"asc" | "desc">(
    (searchParams.get("dir") as "asc" | "desc") || "desc"
  )

  const { loading, fetchData } = useSuperadminFetch<OrgsResponse>()
  const { mutate } = useSuperadminMutation()
  const { mutate: bulkMutate, loading: bulkLoading } = useSuperadminMutation()
  const { formattedLastUpdated, markUpdated } = useLastUpdated()

  const handleSort = (key: string) => {
    let newDir: "asc" | "desc" = "asc"
    if (sortKey === key) {
      newDir = sortDir === "asc" ? "desc" : "asc"
    }
    setSortKey(key)
    setSortDir(newDir)
    setPage(1)
    // Persistir en URL
    const params = new URLSearchParams(window.location.search)
    params.set("sort", key)
    params.set("dir", newDir)
    router.replace(`?${params.toString()}`, { scroll: false })
  }

  // Debounce search input — 400ms sin botón
  const handleSearchChange = (value: string) => {
    setSearch(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(value)
      setPage(1)
    }, 400)
  }

  const handleAdminEmailChange = (value: string) => {
    setAdminEmail(value)
    if (debounceAdminEmailRef.current) clearTimeout(debounceAdminEmailRef.current)
    debounceAdminEmailRef.current = setTimeout(() => {
      setDebouncedAdminEmail(value)
      setPage(1)
    }, 400)
  }

  const fetchOrganizations = useCallback(async () => {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: PAGE_SIZE.toString(),
      ...(debouncedSearch && { search: debouncedSearch }),
      ...(debouncedAdminEmail && { admin_email: debouncedAdminEmail }),
      ...(statusFilter && { status: statusFilter }),
      ...(planFilter && { plan: planFilter }),
      ...(sortKey && { sort: sortKey }),
      ...(sortKey && { dir: sortDir }),
    })

    const result = await fetchData(`/api/superadmin/organizations?${params}`)
    if (result) {
      setOrganizations(result.organizations || [])
      setTotal(result.total || 0)
      if (result.kpis) setKpis(result.kpis)
      markUpdated()
    }
  }, [page, debouncedSearch, debouncedAdminEmail, statusFilter, planFilter, sortKey, sortDir, fetchData])

  useEffect(() => {
    fetchOrganizations()
  }, [fetchOrganizations])

  const handleExportCSV = () => {
    const csv = [
      "nombre,slug,email,telefono,plan,estado,creada",
      ...organizations.map((org) =>
        [
          `"${org.nombre}"`,
          org.slug,
          org.email || "-",
          org.telefono || "-",
          getEffectivePlanLabel(org.subscription),
          org.activo ? "Activa" : "Inactiva",
          org.created_at,
        ].join(",")
      ),
    ].join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `organizaciones-${new Date().toISOString().split("T")[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleToggleStatus = async (
    e: React.MouseEvent,
    org: OrganizationListItem
  ) => {
    e.stopPropagation()
    setTogglingId(org.id)
    await mutate(
      `/api/superadmin/organizations/${org.id}/toggle-status`,
      {
        method: "POST",
        body: { activo: !org.activo },
        successMessage: org.activo
          ? `${org.nombre} desactivada`
          : `${org.nombre} activada`,
        errorMessage: "Error al cambiar el estado",
        onSuccess: fetchOrganizations,
      }
    )
    setTogglingId(null)
  }

  const handleExportSelectedCSV = () => {
    const selected = organizations.filter((org) => selectedIds.includes(org.id))
    if (selected.length === 0) return
    const csv = [
      "nombre,slug,email,telefono,plan,estado,creada",
      ...selected.map((org) =>
        [
          `"${org.nombre}"`,
          org.slug,
          org.email || "-",
          org.telefono || "-",
          getEffectivePlanLabel(org.subscription),
          org.activo ? "Activa" : "Inactiva",
          org.created_at,
        ].join(",")
      ),
    ].join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `organizaciones-seleccionadas-${new Date().toISOString().split("T")[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleBulkToggle = async (activo: boolean) => {
    await bulkMutate("/api/superadmin/organizations/bulk-toggle", {
      method: "POST",
      body: { ids: selectedIds, activo },
      successMessage: activo
        ? `${selectedIds.length} organizaciones activadas`
        : `${selectedIds.length} organizaciones desactivadas`,
      errorMessage: "Error al cambiar estado en lote",
      onSuccess: () => {
        setSelectedIds([])
        fetchOrganizations()
      },
    })
  }

  const handleDeleteOrg = async () => {
    if (!confirmDeleteOrg) return
    setDeletingId(confirmDeleteOrg.id)
    await bulkMutate(`/api/superadmin/organizations/${confirmDeleteOrg.id}`, {
      method: "DELETE",
      successMessage: `"${confirmDeleteOrg.nombre}" eliminada permanentemente`,
      errorMessage: "Error al eliminar organización",
      onSuccess: () => {
        setConfirmDeleteOrg(null)
        setDeletingId(null)
        fetchOrganizations()
      },
    })
    setDeletingId(null)
  }

  const handleBulkDelete = async () => {
    await bulkMutate("/api/superadmin/organizations/bulk-delete", {
      method: "POST",
      body: { ids: selectedIds },
      successMessage: `${selectedIds.length} organizaciones eliminadas`,
      errorMessage: "Error al eliminar organizaciones",
      onSuccess: () => {
        setSelectedIds([])
        setConfirmBulkDelete(false)
        fetchOrganizations()
      },
    })
  }

  const columns: Column<OrganizationListItem>[] = [
    {
      key: "nombre",
      header: "Organización",
      sortable: true,
      render: (org) => {
        // Health indicator basado en última actividad
        let healthColor = "bg-red-500" // sin actividad o > 30 días
        let healthTitle = "Sin actividad reciente (>30 días)"
        if (org.last_activity_at) {
          const daysSince = Math.floor(
            (Date.now() - new Date(org.last_activity_at).getTime()) / (1000 * 60 * 60 * 24)
          )
          if (daysSince <= 7) {
            healthColor = "bg-green-500"
            healthTitle = `Activa (hace ${daysSince}d)`
          } else if (daysSince <= 30) {
            healthColor = "bg-amber-500"
            healthTitle = `Actividad moderada (hace ${daysSince}d)`
          }
        }
        return (
          <div className="flex items-start gap-2">
            <span
              className={`mt-1.5 h-2.5 w-2.5 rounded-full shrink-0 ${healthColor}`}
              title={healthTitle}
            />
            <div>
              <div className="font-medium">{org.nombre}</div>
              <a
                href={`https://${org.slug}.stapp.com.ar`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-sm text-muted-foreground hover:text-primary hover:underline inline-flex items-center gap-1"
              >
                {org.slug}.stapp.com.ar
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        )
      },
    },
    {
      key: "email",
      header: "Email",
      hideOnMobile: true,
      render: (org) => org.email || "-",
    },
    {
      key: "telefono",
      header: "Teléfono",
      hideOnMobile: true,
      render: (org) => org.telefono ? (
        <span className="flex items-center gap-1">
          <Phone className="h-3 w-3 text-muted-foreground" />
          {org.telefono}
        </span>
      ) : (
        <span className="text-muted-foreground">-</span>
      ),
    },
    {
      key: "usersCount",
      header: "Usuarios",
      sortable: true,
      className: "text-center",
      render: (org) => org.usersCount,
    },
    {
      key: "subscription",
      header: "Plan",
      sortable: true,
      render: (org) => {
        const label = getEffectivePlanLabel(org.subscription)
        const isPremium = isEffectivelyPremium(org.subscription)
        const isExpired = isTrialExpired(org.subscription)

        return (
          <Badge variant={isPremium ? "default" : isExpired ? "destructive" : "secondary"}>
            {label}
          </Badge>
        )
      },
    },
    {
      key: "trial_days",
      header: "Trial",
      hideOnMobile: true,
      render: (org) => {
        if (isEffectivelyPremium(org.subscription)) {
          return <Badge variant="default">Pago</Badge>
        }

        // Usar trial_end real de la suscripción
        const trialEnd = org.subscription?.trial_end
          ? new Date(org.subscription.trial_end)
          : null

        if (!trialEnd) {
          return <span className="text-muted-foreground text-xs">-</span>
        }

        const now = new Date()
        const daysLeft = Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

        if (daysLeft <= 0) {
          return (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-red-600 bg-red-100 dark:bg-red-950">
              Expirado
            </span>
          )
        }

        const color =
          daysLeft > 14
            ? "text-green-600 bg-green-100 dark:bg-green-950"
            : daysLeft > 5
              ? "text-amber-600 bg-amber-100 dark:bg-amber-950"
              : "text-red-600 bg-red-100 dark:bg-red-950"
        return (
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color}`}>
            {daysLeft}d
          </span>
        )
      },
    },
    {
      key: "activo",
      header: "Estado",
      sortable: true,
      render: (org) => (
        <Badge variant={org.activo ? "default" : "destructive"}>
          {org.activo ? "Activa" : "Inactiva"}
        </Badge>
      ),
    },
    {
      key: "created_at",
      header: "Creada",
      sortable: true,
      hideOnMobile: true,
      render: (org) => formatDate(org.created_at),
    },
    {
      key: "actions",
      header: "Acciones",
      render: (org) => (
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => router.push(`/superadmin/organizaciones/${org.id}`)}
            title="Ver detalle"
          >
            <Eye className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => handleToggleStatus(e, org)}
            title={org.activo ? "Desactivar" : "Activar"}
            disabled={togglingId === org.id}
          >
            {togglingId === org.id ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : org.activo ? (
              <PowerOff className="h-4 w-4 text-red-500" />
            ) : (
              <Power className="h-4 w-4 text-green-500" />
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setConfirmDeleteOrg({ id: org.id, nombre: org.nombre })}
            title="Eliminar permanentemente"
            disabled={deletingId === org.id}
          >
            {deletingId === org.id ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4 text-red-500" />
            )}
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Building2 className="h-8 w-8" />
            Organizaciones
          </h1>
          <p className="text-muted-foreground">
            Gestiona todas las organizaciones del sistema
          </p>
          <LastUpdated
            formattedLastUpdated={formattedLastUpdated}
            onRefresh={fetchOrganizations}
            loading={loading}
          />
        </div>
        <Button
          variant="outline"
          onClick={handleExportCSV}
          disabled={organizations.length === 0}
        >
          <Download className="h-4 w-4 mr-2" />
          Exportar CSV
        </Button>
      </div>

      {/* KPIs */}
      {kpis ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          {[
            {
              title: "Total organizaciones",
              value: kpis.totalOrgs,
              icon: Building2,
              description: "Registradas en el sistema",
              color: "text-blue-600",
              bgColor: "bg-blue-100 dark:bg-blue-950",
            },
            {
              title: "Activas en trial",
              value: kpis.activeTrial,
              icon: Users,
              description: "Plan Free activas",
              color: "text-amber-600",
              bgColor: "bg-amber-100 dark:bg-amber-950",
            },
            {
              title: "Premium",
              value: kpis.premium,
              icon: CreditCard,
              description: "Con plan de pago activo",
              color: "text-green-600",
              bgColor: "bg-green-100 dark:bg-green-950",
            },
            {
              title: "Nuevas este mes",
              value: kpis.newThisMonth,
              icon: CalendarPlus,
              description: "Creadas en el mes actual",
              color: "text-purple-600",
              bgColor: "bg-purple-100 dark:bg-purple-950",
            },
            {
              title: "Tasa de conversión",
              value: `${kpis.conversionRate}%`,
              icon: TrendingUp,
              description: "Free → Premium",
              color: "text-cyan-600",
              bgColor: "bg-cyan-100 dark:bg-cyan-950",
            },
          ].map((stat) => {
            const Icon = stat.icon
            return (
              <Card key={stat.title} className="hover:shadow-md transition-shadow">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {stat.title}
                  </CardTitle>
                  <div className={`p-2 rounded-lg ${stat.bgColor}`}>
                    <Icon className={`h-4 w-4 ${stat.color}`} />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stat.value}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {stat.description}
                  </p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      ) : loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div className="h-4 w-24 bg-muted rounded" />
                <div className="h-8 w-8 bg-muted rounded-lg" />
              </CardHeader>
              <CardContent>
                <div className="h-7 w-16 bg-muted rounded mb-1" />
                <div className="h-3 w-20 bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="flex-1 relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nombre, slug o email..."
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex-1 relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Email del admin (registro)..."
                value={adminEmail}
                onChange={(e) => handleAdminEmailChange(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2">
              <Select
                value={statusFilter || "all"}
                onValueChange={(value) => {
                  setStatusFilter(value === "all" ? "" : value)
                  setPage(1)
                }}
              >
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Todos los estados" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los estados</SelectItem>
                  <SelectItem value="active">Activas</SelectItem>
                  <SelectItem value="inactive">Inactivas</SelectItem>
                  <SelectItem value="no_activity">Sin actividad (30d)</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={planFilter || "all"}
                onValueChange={(value) => {
                  setPlanFilter(value === "all" ? "" : value)
                  setPage(1)
                }}
              >
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Todos los planes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los planes</SelectItem>
                  <SelectItem value="free">Free / Trial</SelectItem>
                  <SelectItem value="premium">Premium (pago)</SelectItem>
                  <SelectItem value="trial_expired">Trial expirado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {selectedIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-4 p-3 rounded-lg bg-muted/50 border">
              <span className="text-sm font-medium">
                {selectedIds.length} seleccionados
              </span>
              <div className="flex flex-wrap gap-2 ml-auto">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-green-600 border-green-600 hover:bg-green-50"
                  onClick={() => handleBulkToggle(true)}
                  disabled={bulkLoading}
                >
                  {bulkLoading ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <CheckCircle className="h-4 w-4 mr-1.5" />
                  )}
                  Activar seleccionados
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-600 border-red-600 hover:bg-red-50"
                  onClick={() => setConfirmDeactivateOpen(true)}
                  disabled={bulkLoading}
                >
                  <XCircle className="h-4 w-4 mr-1.5" />
                  Desactivar seleccionados
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleExportSelectedCSV}
                >
                  <Download className="h-4 w-4 mr-1.5" />
                  Exportar seleccionadas
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setConfirmBulkDelete(true)}
                  disabled={bulkLoading}
                >
                  <Trash2 className="h-4 w-4 mr-1.5" />
                  Eliminar seleccionados
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedIds([])}
                  disabled={bulkLoading}
                >
                  <X className="h-4 w-4 mr-1.5" />
                  Deseleccionar
                </Button>
              </div>
            </div>
          )}
          <DataTable
            data={organizations}
            columns={columns}
            keyExtractor={(org) => org.id}
            loading={loading}
            emptyMessage="No se encontraron organizaciones"
            onRowClick={(org) => router.push(`/superadmin/organizaciones/${org.id}`)}
            sortKey={sortKey}
            sortDirection={sortDir}
            onSort={handleSort}
            selectable={true}
            selectedKeys={selectedIds}
            onSelectionChange={setSelectedIds}
            pagination={{
              page,
              pageSize: PAGE_SIZE,
              total,
              onPageChange: setPage,
            }}
          />
        </CardContent>
      </Card>

      {/* Modal de confirmación para desactivar en lote */}
      <Dialog open={confirmDeactivateOpen} onOpenChange={setConfirmDeactivateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Confirmar desactivación
            </DialogTitle>
            <DialogDescription>
              Estás por desactivar {selectedIds.length} organización{selectedIds.length > 1 ? "es" : ""}.
              Los usuarios de estas organizaciones perderán acceso al sistema.
              Esta acción se puede revertir.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 justify-end pt-2">
            <Button
              variant="outline"
              onClick={() => setConfirmDeactivateOpen(false)}
              disabled={bulkLoading}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                await handleBulkToggle(false)
                setConfirmDeactivateOpen(false)
              }}
              disabled={bulkLoading}
            >
              {bulkLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Desactivando...
                </>
              ) : (
                <>
                  <XCircle className="h-4 w-4 mr-2" />
                  Desactivar {selectedIds.length}
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog: Confirmar eliminación individual */}
      <Dialog open={!!confirmDeleteOrg} onOpenChange={(open) => !open && setConfirmDeleteOrg(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Eliminar organización
            </DialogTitle>
            <DialogDescription>
              Estás por eliminar permanentemente <strong>&quot;{confirmDeleteOrg?.nombre}&quot;</strong> y todos sus datos
              (usuarios, órdenes, clientes, inventario, suscripciones, pagos).
              <br /><br />
              <strong className="text-red-600">Esta acción NO se puede revertir.</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="outline" onClick={() => setConfirmDeleteOrg(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDeleteOrg} disabled={!!deletingId}>
              {deletingId ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Eliminando...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Eliminar permanentemente
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog: Confirmar eliminación masiva */}
      <Dialog open={confirmBulkDelete} onOpenChange={setConfirmBulkDelete}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Eliminar {selectedIds.length} organizaciones
            </DialogTitle>
            <DialogDescription>
              Estás por eliminar permanentemente {selectedIds.length} organización{selectedIds.length > 1 ? "es" : ""} y todos sus datos.
              <br /><br />
              <strong className="text-red-600">Esta acción NO se puede revertir.</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="outline" onClick={() => setConfirmBulkDelete(false)} disabled={bulkLoading}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleBulkDelete} disabled={bulkLoading}>
              {bulkLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Eliminando...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Eliminar {selectedIds.length} permanentemente
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
