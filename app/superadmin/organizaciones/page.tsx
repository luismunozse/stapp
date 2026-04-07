"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DataTable, Column } from "@/components/ui/data-table"
import { Search, Eye, Power, PowerOff, Building2, Loader2, Download, CheckCircle, XCircle, X, Phone } from "lucide-react"
import { formatDate } from "@/lib/utils"
import { useSuperadminFetch, useSuperadminMutation } from "@/hooks/use-superadmin-fetch"
import { useLastUpdated } from "@/hooks/use-last-updated"
import { LastUpdated } from "@/components/superadmin/last-updated"
import type { OrganizationListItem } from "@/types/superadmin"
import { getEffectivePlanLabel, isEffectivelyPremium } from "@/lib/subscription-status"

const PAGE_SIZE = 20

interface OrgsResponse {
  organizations: OrganizationListItem[]
  total: number
}

export default function OrganizacionesPage() {
  const router = useRouter()
  const [organizations, setOrganizations] = useState<OrganizationListItem[]>([])
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [planFilter, setPlanFilter] = useState("")
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { loading, fetchData } = useSuperadminFetch<OrgsResponse>()
  const { mutate } = useSuperadminMutation()
  const { mutate: bulkMutate, loading: bulkLoading } = useSuperadminMutation()
  const { formattedLastUpdated, markUpdated } = useLastUpdated()

  // Debounce search input
  const handleSearchChange = (value: string) => {
    setSearch(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(value)
      setPage(1)
    }, 300)
  }

  const fetchOrganizations = useCallback(async () => {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: PAGE_SIZE.toString(),
      ...(debouncedSearch && { search: debouncedSearch }),
      ...(statusFilter && { status: statusFilter }),
      ...(planFilter && { plan: planFilter }),
    })

    const result = await fetchData(`/api/superadmin/organizations?${params}`)
    if (result) {
      setOrganizations(result.organizations || [])
      setTotal(result.total || 0)
      markUpdated()
    }
  }, [page, debouncedSearch, statusFilter, planFilter, fetchData])

  useEffect(() => {
    fetchOrganizations()
  }, [fetchOrganizations])

  const handleSearch = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setDebouncedSearch(search)
    setPage(1)
  }

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

  const columns: Column<OrganizationListItem>[] = [
    {
      key: "nombre",
      header: "Organización",
      render: (org) => (
        <div>
          <div className="font-medium">{org.nombre}</div>
          <div className="text-sm text-muted-foreground">
            {org.slug}.stapp.com.ar
          </div>
        </div>
      ),
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
      className: "text-center",
      render: (org) => org.usersCount,
    },
    {
      key: "subscription",
      header: "Plan",
      render: (org) => (
        <Badge variant={isEffectivelyPremium(org.subscription) ? "default" : "secondary"}>
          {getEffectivePlanLabel(org.subscription)}
        </Badge>
      ),
    },
    {
      key: "activo",
      header: "Estado",
      render: (org) => (
        <Badge variant={org.activo ? "default" : "destructive"}>
          {org.activo ? "Activa" : "Inactiva"}
        </Badge>
      ),
    },
    {
      key: "created_at",
      header: "Creada",
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

      <Card>
        <CardHeader>
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="flex-1 flex gap-2">
              <Input
                placeholder="Buscar por nombre, slug o email..."
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="max-w-sm"
              />
              <Button onClick={handleSearch} variant="secondary">
                <Search className="h-4 w-4 mr-2" />
                Buscar
              </Button>
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
                  <SelectItem value="free">Free</SelectItem>
                  <SelectItem value="premium">Premium</SelectItem>
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
                  onClick={() => handleBulkToggle(false)}
                  disabled={bulkLoading}
                >
                  {bulkLoading ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <XCircle className="h-4 w-4 mr-1.5" />
                  )}
                  Desactivar seleccionados
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
    </div>
  )
}
