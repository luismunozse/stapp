"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { DataTable, Column } from "@/components/ui/data-table"
import { CreditCard, Eye, Download } from "lucide-react"
import { formatDate } from "@/lib/utils"
import { useSuperadminFetch } from "@/hooks/use-superadmin-fetch"
import { useLastUpdated } from "@/hooks/use-last-updated"
import { LastUpdated } from "@/components/superadmin/last-updated"
import type { SubscriptionListItem } from "@/types/superadmin"

const PAGE_SIZE = 20

interface SubsResponse {
  subscriptions: SubscriptionListItem[]
  total: number
}

export default function SuscripcionesPage() {
  const router = useRouter()
  const [subscriptions, setSubscriptions] = useState<SubscriptionListItem[]>([])
  const [statusFilter, setStatusFilter] = useState("")
  const [planFilter, setPlanFilter] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  const { loading, fetchData } = useSuperadminFetch<SubsResponse>()
  const { formattedLastUpdated, markUpdated } = useLastUpdated()

  const fetchSubscriptions = useCallback(async () => {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: PAGE_SIZE.toString(),
      ...(statusFilter && { status: statusFilter }),
      ...(planFilter && { plan: planFilter }),
      ...(dateFrom && { dateFrom }),
      ...(dateTo && { dateTo }),
    })

    const result = await fetchData(`/api/superadmin/subscriptions?${params}`)
    if (result) {
      setSubscriptions(result.subscriptions || [])
      setTotal(result.total || 0)
      markUpdated()
    }
  }, [page, statusFilter, planFilter, dateFrom, dateTo, fetchData])

  useEffect(() => {
    fetchSubscriptions()
  }, [fetchSubscriptions])

  const handleExportCSV = () => {
    const csv = [
      "organizacion,plan,estado,periodo,vence",
      ...subscriptions.map((sub) =>
        [
          `"${sub.organization?.nombre || "-"}"`,
          sub.plans?.nombre || "Free",
          sub.status,
          sub.billing_period || "-",
          sub.current_period_end || "-",
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

  const getStatusVariant = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return "default"
      case "TRIALING":
        return "secondary"
      case "PAST_DUE":
        return "warning" as "default"
      case "CANCELED":
        return "destructive"
      default:
        return "secondary"
    }
  }

  const columns: Column<SubscriptionListItem>[] = [
    {
      key: "organization",
      header: "Organización",
      render: (sub) => (
        <div>
          <div className="font-medium">{sub.organization?.nombre || "-"}</div>
          <div className="text-sm text-muted-foreground">
            {sub.organization?.slug}.stapp.com.ar
          </div>
        </div>
      ),
    },
    {
      key: "plans",
      header: "Plan",
      render: (sub) => (
        <Badge
          variant={sub.plans?.tipo === "PREMIUM" ? "default" : "secondary"}
        >
          {sub.plans?.nombre || "Free"}
        </Badge>
      ),
    },
    {
      key: "status",
      header: "Estado",
      render: (sub) => (
        <Badge variant={getStatusVariant(sub.status)}>{sub.status}</Badge>
      ),
    },
    {
      key: "billing_period",
      header: "Período",
      hideOnMobile: true,
      render: (sub) => sub.billing_period || "-",
    },
    {
      key: "current_period_end",
      header: "Vence",
      render: (sub) =>
        sub.current_period_end ? formatDate(sub.current_period_end) : "-",
    },
    {
      key: "cancel_at_period_end",
      header: "Cancelación",
      hideOnMobile: true,
      render: (sub) =>
        sub.cancel_at_period_end ? (
          <Badge variant="secondary">Pendiente</Badge>
        ) : (
          "-"
        ),
    },
    {
      key: "actions",
      header: "Acciones",
      render: (sub) => (
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            router.push(`/superadmin/organizaciones/${sub.organization?.id}`)
          }
          title="Ver organización"
        >
          <Eye className="h-4 w-4" />
        </Button>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <CreditCard className="h-8 w-8" />
            Suscripciones
          </h1>
          <p className="text-muted-foreground">
            Gestiona todas las suscripciones del sistema
          </p>
          <LastUpdated
            formattedLastUpdated={formattedLastUpdated}
            onRefresh={fetchSubscriptions}
            loading={loading}
          />
        </div>
        <Button
          variant="outline"
          onClick={handleExportCSV}
          disabled={subscriptions.length === 0}
        >
          <Download className="h-4 w-4 mr-2" />
          Exportar CSV
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col lg:flex-row gap-4">
            <Select
              value={statusFilter || "all"}
              onValueChange={(value) => {
                setStatusFilter(value === "all" ? "" : value)
                setPage(1)
              }}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Todos los estados" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                <SelectItem value="active">Activas</SelectItem>
                <SelectItem value="trialing">En prueba</SelectItem>
                <SelectItem value="past_due">Pago pendiente</SelectItem>
                <SelectItem value="canceled">Canceladas</SelectItem>
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
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Desde:</span>
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
              <span className="text-sm text-muted-foreground">Hasta:</span>
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
            {(dateFrom || dateTo || statusFilter || planFilter) && (
              <Button
                variant="ghost"
                onClick={() => {
                  setDateFrom("")
                  setDateTo("")
                  setStatusFilter("")
                  setPlanFilter("")
                  setPage(1)
                }}
              >
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
