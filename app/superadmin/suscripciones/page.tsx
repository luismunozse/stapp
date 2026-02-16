"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DataTable, Column } from "@/components/ui/data-table"
import { CreditCard, Eye } from "lucide-react"
import { formatDate } from "@/lib/utils"
import type { SubscriptionListItem } from "@/types/superadmin"

export default function SuscripcionesPage() {
  const router = useRouter()
  const [subscriptions, setSubscriptions] = useState<SubscriptionListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState("")
  const [planFilter, setPlanFilter] = useState("")
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  const fetchSubscriptions = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: "20",
        ...(statusFilter && { status: statusFilter }),
        ...(planFilter && { plan: planFilter }),
      })

      const res = await fetch(`/api/superadmin/subscriptions?${params}`)
      if (!res.ok) throw new Error("Error fetching subscriptions")

      const data = await res.json()
      setSubscriptions(data.subscriptions || [])
      setTotal(data.total || 0)
    } catch (error) {
      console.error("Error:", error)
    } finally {
      setLoading(false)
    }
  }, [page, statusFilter, planFilter])

  useEffect(() => {
    fetchSubscriptions()
  }, [fetchSubscriptions])

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
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <CreditCard className="h-8 w-8" />
          Suscripciones
        </h1>
        <p className="text-muted-foreground">
          Gestiona todas las suscripciones del sistema
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row gap-4">
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
