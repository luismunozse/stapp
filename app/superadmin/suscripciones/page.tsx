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
  counts: {
    active: number
    trialing: number
    expiredTrials: number
    canceled: number
  }
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
  const [counts, setCounts] = useState({ active: 0, trialing: 0, expiredTrials: 0, canceled: 0 })

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
      if (result.counts) setCounts(result.counts)
      markUpdated()
    }
  }, [page, statusFilter, planFilter, dateFrom, dateTo, fetchData])

  useEffect(() => {
    fetchSubscriptions()
  }, [fetchSubscriptions])

  const handleExportCSV = () => {
    const csv = [
      "organizacion,slug,plan,estado,proveedor_pago,periodo,vence_trial,vence_periodo,cancelacion_pendiente,creado",
      ...subscriptions.map((sub) =>
        [
          `"${sub.organization?.nombre || "-"}"`,
          sub.organization?.slug || "-",
          sub.plans?.nombre || "Free",
          sub.status,
          sub.payment_provider || "-",
          sub.billing_period || "-",
          sub.trial_end || "-",
          sub.current_period_end || "-",
          sub.cancel_at_period_end ? "Si" : "No",
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

  const getStatusBadge = (sub: SubscriptionListItem) => {
    const now = new Date()

    switch (sub.status) {
      case "ACTIVE":
        return <Badge variant="default">Activa</Badge>
      case "TRIALING": {
        if (sub.trial_end) {
          const trialEnd = new Date(sub.trial_end)
          const daysLeft = Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
          if (daysLeft <= 0) {
            return <Badge variant="destructive">Trial vencido</Badge>
          }
          if (daysLeft <= 3) {
            return (
              <Badge variant="destructive">
                Trial · {daysLeft}d
              </Badge>
            )
          }
          if (daysLeft <= 7) {
            return (
              <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                Trial · {daysLeft}d
              </Badge>
            )
          }
          return (
            <Badge variant="secondary">
              Trial · {daysLeft}d
            </Badge>
          )
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

  const getVencimiento = (sub: SubscriptionListItem) => {
    if (sub.status === "TRIALING" && sub.trial_end) {
      return formatDate(sub.trial_end)
    }
    if (sub.current_period_end) {
      return formatDate(sub.current_period_end)
    }
    return "-"
  }

  const columns: Column<SubscriptionListItem>[] = [
    {
      key: "organization",
      header: "Organizacion",
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
      render: (sub) => {
        // Trial con plan Premium pero sin pago = mostrar como "Free (trial)"
        const isPaidPremium = sub.plans?.tipo === "PREMIUM" && sub.status === "ACTIVE" && !!sub.payment_provider
        const isTrialPremium = sub.plans?.tipo === "PREMIUM" && sub.status === "TRIALING"

        if (isPaidPremium) {
          return <Badge variant="default">Premium</Badge>
        }
        if (isTrialPremium) {
          return <Badge variant="secondary">Free (trial)</Badge>
        }
        return <Badge variant="secondary">{sub.plans?.nombre || "Free"}</Badge>
      },
    },
    {
      key: "status",
      header: "Estado",
      render: (sub) => getStatusBadge(sub),
    },
    {
      key: "payment_provider",
      header: "Pago",
      hideOnMobile: true,
      render: (sub) => {
        if (!sub.payment_provider) return <span className="text-muted-foreground">-</span>
        const labels: Record<string, string> = {
          MERCADOPAGO: "MercadoPago",
          REBILL: "Rebill (USD)",
        }
        return <span className="text-sm">{labels[sub.payment_provider] || sub.payment_provider}</span>
      },
    },
    {
      key: "billing_period",
      header: "Periodo",
      hideOnMobile: true,
      render: (sub) => {
        if (!sub.billing_period) return <span className="text-muted-foreground">-</span>
        return sub.billing_period === "YEARLY" ? "Anual" : "Mensual"
      },
    },
    {
      key: "vencimiento",
      header: "Vence",
      render: (sub) => {
        const text = getVencimiento(sub)
        if (text === "-") return <span className="text-muted-foreground">-</span>

        // Highlight si está por vencer pronto
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
      key: "cancel_at_period_end",
      header: "Cancelacion",
      hideOnMobile: true,
      render: (sub) =>
        sub.cancel_at_period_end ? (
          <Badge variant="secondary">Pendiente</Badge>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: "actions",
      header: "",
      render: (sub) => (
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            router.push(`/superadmin/organizaciones/${sub.organization?.id}`)
          }
          title="Ver organizacion"
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

      {/* Quick stats - counts from backend (global, not per-page) */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Activas</p>
            <p className="text-2xl font-bold text-green-600">{counts.active}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">En trial</p>
            <p className="text-2xl font-bold text-blue-600">{counts.trialing}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Trials vencidos</p>
            <p className="text-2xl font-bold text-red-600">{counts.expiredTrials}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Canceladas</p>
            <p className="text-2xl font-bold text-amber-600">{counts.canceled}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Total</p>
            <p className="text-2xl font-bold">{counts.active + counts.trialing + counts.expiredTrials + counts.canceled}</p>
          </CardContent>
        </Card>
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
              <span className="text-sm text-muted-foreground whitespace-nowrap">Desde:</span>
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
              <span className="text-sm text-muted-foreground whitespace-nowrap">Hasta:</span>
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
