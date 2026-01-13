"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select } from "@/components/ui/select"
import { DataTable, Column } from "@/components/ui/data-table"
import { Search, Eye, Power, PowerOff, Building2 } from "lucide-react"
import { formatDate } from "@/lib/utils"
import type { OrganizationListItem } from "@/types/superadmin"

export default function OrganizacionesPage() {
  const router = useRouter()
  const [organizations, setOrganizations] = useState<OrganizationListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [planFilter, setPlanFilter] = useState("")
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  const fetchOrganizations = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: "20",
        ...(search && { search }),
        ...(statusFilter && { status: statusFilter }),
        ...(planFilter && { plan: planFilter }),
      })

      const res = await fetch(`/api/superadmin/organizations?${params}`)
      if (!res.ok) throw new Error("Error fetching organizations")

      const data = await res.json()
      setOrganizations(data.organizations || [])
      setTotal(data.total || 0)
    } catch (error) {
      console.error("Error:", error)
    } finally {
      setLoading(false)
    }
  }, [page, search, statusFilter, planFilter])

  useEffect(() => {
    fetchOrganizations()
  }, [fetchOrganizations])

  const handleSearch = () => {
    setPage(1)
    fetchOrganizations()
  }

  const handleToggleStatus = async (
    e: React.MouseEvent,
    org: OrganizationListItem
  ) => {
    e.stopPropagation()
    try {
      const res = await fetch(
        `/api/superadmin/organizations/${org.id}/toggle-status`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ activo: !org.activo }),
        }
      )
      if (!res.ok) throw new Error("Error toggling status")
      fetchOrganizations()
    } catch (error) {
      console.error("Error:", error)
    }
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
      render: (org) => org.email || "-",
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
        <Badge
          variant={
            org.subscription?.plans?.tipo === "PREMIUM" ? "default" : "secondary"
          }
        >
          {org.subscription?.plans?.nombre || "Free"}
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
            onClick={() => router.push(`/organizaciones/${org.id}`)}
            title="Ver detalle"
          >
            <Eye className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => handleToggleStatus(e, org)}
            title={org.activo ? "Desactivar" : "Activar"}
          >
            {org.activo ? (
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
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Building2 className="h-8 w-8" />
          Organizaciones
        </h1>
        <p className="text-muted-foreground">
          Gestiona todas las organizaciones del sistema
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="flex-1 flex gap-2">
              <Input
                placeholder="Buscar por nombre, slug o email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
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
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value)
                  setPage(1)
                }}
                className="w-[150px]"
              >
                <option value="">Todos los estados</option>
                <option value="active">Activas</option>
                <option value="inactive">Inactivas</option>
              </Select>
              <Select
                value={planFilter}
                onChange={(e) => {
                  setPlanFilter(e.target.value)
                  setPage(1)
                }}
                className="w-[150px]"
              >
                <option value="">Todos los planes</option>
                <option value="free">Free</option>
                <option value="premium">Premium</option>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            data={organizations}
            columns={columns}
            keyExtractor={(org) => org.id}
            loading={loading}
            emptyMessage="No se encontraron organizaciones"
            onRowClick={(org) => router.push(`/organizaciones/${org.id}`)}
            pagination={{
              page,
              pageSize: 20,
              total,
              onPageChange: setPage,
            }}
          />
        </CardContent>
      </Card>
    </div>
  )
}
