"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { DataTable, Column } from "@/components/ui/data-table"
import {
  Receipt,
  Eye,
  ExternalLink,
  DollarSign,
  Download,
  Search,
  TrendingUp,
  CreditCard,
  AlertCircle,
  Clock,
} from "lucide-react"
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils"
import { DEFAULT_TIMEZONE } from "@/lib/timezone"
import { useSuperadminFetch } from "@/hooks/use-superadmin-fetch"
import { useLastUpdated } from "@/hooks/use-last-updated"
import { LastUpdated } from "@/components/superadmin/last-updated"
import type { PaymentWithOrg, PaymentStats } from "@/types/superadmin"
import { ReconcileMpCard } from "./_components/reconcile-mp-card"
import { WebhookEventsCard } from "./_components/webhook-events-card"

const PAGE_SIZE = 20

function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === "https:" || parsed.protocol === "http:"
  } catch {
    return false
  }
}

function formatShortDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—"
  try {
    return new Date(dateStr).toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: DEFAULT_TIMEZONE,
    })
  } catch {
    return "—"
  }
}

function getProviderPaymentUrl(provider: string | null | undefined, paymentId: string | null | undefined): string | null {
  if (!paymentId) return null
  if (provider === "MERCADOPAGO") {
    return `https://www.mercadopago.com.ar/activities/search?query=${encodeURIComponent(paymentId)}`
  }
  // Rebill no tiene URL pública estándar
  return null
}

interface PaymentsResponse {
  payments: PaymentWithOrg[]
  total: number
  totalAmount: number
  stats?: PaymentStats
}

export default function PagosPage() {
  const router = useRouter()
  const [payments, setPayments] = useState<PaymentWithOrg[]>([])
  const [statusFilter, setStatusFilter] = useState("")
  const [providerFilter, setProviderFilter] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [searchInput, setSearchInput] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalAmount, setTotalAmount] = useState(0)
  const [stats, setStats] = useState<PaymentStats | null>(null)

  const { loading, fetchData } = useSuperadminFetch<PaymentsResponse>()
  const { formattedLastUpdated, markUpdated } = useLastUpdated()

  const fetchPayments = useCallback(async () => {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: PAGE_SIZE.toString(),
      includeStats: "true",
      ...(statusFilter && { status: statusFilter }),
      ...(providerFilter && { provider: providerFilter }),
      ...(dateFrom && { dateFrom }),
      ...(dateTo && { dateTo }),
      ...(searchQuery && { search: searchQuery }),
    })

    const result = await fetchData(`/api/superadmin/payments?${params}`)
    if (result) {
      setPayments(result.payments || [])
      setTotal(result.total || 0)
      setTotalAmount(result.totalAmount || 0)
      setStats(result.stats || null)
      markUpdated()
    }
  }, [page, statusFilter, providerFilter, dateFrom, dateTo, searchQuery, fetchData])

  useEffect(() => {
    fetchPayments()
  }, [fetchPayments])

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(searchInput)
      setPage(1)
    }, 400)
    return () => clearTimeout(timer)
  }, [searchInput])

  const handleExportCSV = () => {
    const csv = [
      "fecha,organizacion,monto,estado,proveedor,plan,periodo_inicio,periodo_fin,payment_id",
      ...payments.map((p) =>
        [
          p.paid_at || p.created_at,
          `"${p.organization?.nombre || "-"}"`,
          p.amount,
          p.status,
          p.payment_provider || "-",
          `"${p.plan_name || "-"}"`,
          p.period_start || "",
          p.period_end || "",
          p.provider_payment_id || "",
        ].join(",")
      ),
    ].join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `pagos-${new Date().toISOString().split("T")[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "SUCCEEDED":
        return (
          <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border-green-300">
            {status}
          </Badge>
        )
      case "PENDING":
        return (
          <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 border-yellow-300">
            {status}
          </Badge>
        )
      case "FAILED":
        return (
          <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 border-red-300">
            {status}
          </Badge>
        )
      case "REFUNDED":
        return (
          <Badge className="bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200 border-gray-300">
            {status}
          </Badge>
        )
      default:
        return <Badge variant="secondary">{status}</Badge>
    }
  }

  const columns: Column<PaymentWithOrg>[] = [
    {
      key: "paid_at",
      header: "Fecha",
      render: (payment) =>
        payment.paid_at
          ? formatDateTime(payment.paid_at)
          : formatDateTime(payment.created_at),
    },
    {
      key: "organization",
      header: "Organización",
      render: (payment) => (
        <div>
          <div className="font-medium">
            {payment.organization?.nombre || "-"}
          </div>
          <div className="text-sm text-muted-foreground">
            {payment.organization?.slug}
          </div>
        </div>
      ),
    },
    {
      key: "plan_name",
      header: "Plan",
      hideOnMobile: true,
      render: (payment) => (
        <span className="text-sm">{payment.plan_name || "—"}</span>
      ),
    },
    {
      key: "period",
      header: "Período",
      hideOnMobile: true,
      render: (payment) => {
        if (!payment.period_start && !payment.period_end) return <span className="text-muted-foreground">—</span>
        return (
          <span className="text-xs text-muted-foreground">
            {formatShortDate(payment.period_start)} – {formatShortDate(payment.period_end)}
          </span>
        )
      },
    },
    {
      key: "amount",
      header: "Monto",
      render: (payment) => (
        <span className="font-medium">{formatCurrency(payment.amount)}</span>
      ),
    },
    {
      key: "status",
      header: "Estado",
      render: (payment) => getStatusBadge(payment.status),
    },
    {
      key: "payment_provider",
      header: "Proveedor",
      hideOnMobile: true,
      render: (payment) => payment.payment_provider || "-",
    },
    {
      key: "provider_payment_id",
      header: "Payment ID",
      hideOnMobile: true,
      render: (payment) => {
        if (!payment.provider_payment_id) return <span className="text-muted-foreground">—</span>
        const url = getProviderPaymentUrl(payment.payment_provider, payment.provider_payment_id)
        if (url) {
          return (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-mono text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
            >
              {payment.provider_payment_id.length > 15
                ? `${payment.provider_payment_id.slice(0, 15)}...`
                : payment.provider_payment_id}
              <ExternalLink className="h-3 w-3" />
            </a>
          )
        }
        return (
          <span className="text-xs font-mono text-muted-foreground">
            {payment.provider_payment_id.length > 15
              ? `${payment.provider_payment_id.slice(0, 15)}...`
              : payment.provider_payment_id}
          </span>
        )
      },
    },
    {
      key: "actions",
      header: "Acciones",
      render: (payment) => (
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              router.push(`/superadmin/organizaciones/${payment.organization_id}`)
            }
            title="Ver organización"
          >
            <Eye className="h-4 w-4" />
          </Button>
          {payment.receipt_url && isSafeUrl(payment.receipt_url) && (
            <a
              href={payment.receipt_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button size="sm" variant="ghost" title="Ver recibo">
                <ExternalLink className="h-4 w-4" />
              </Button>
            </a>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Receipt className="h-8 w-8" />
            Pagos
          </h1>
          <p className="text-muted-foreground">
            Historial de pagos de todas las organizaciones
          </p>
          <LastUpdated
            formattedLastUpdated={formattedLastUpdated}
            onRefresh={fetchPayments}
            loading={loading}
          />
        </div>
        <Button
          variant="outline"
          onClick={handleExportCSV}
          disabled={payments.length === 0}
        >
          <Download className="h-4 w-4 mr-2" />
          Exportar CSV
        </Button>
      </div>

      {/* KPI Dashboard */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 dark:bg-green-950 rounded-lg">
                <TrendingUp className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <div className="text-xs text-muted-foreground">MRR</div>
                <div className="text-xl font-bold">
                  {formatCurrency(stats?.mrr ?? 0)}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 dark:bg-blue-950 rounded-lg">
                <DollarSign className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Total histórico</div>
                <div className="text-xl font-bold">
                  {formatCurrency(stats?.totalHistorico ?? 0)}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 dark:bg-purple-950 rounded-lg">
                <CreditCard className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Pagos este mes</div>
                <div className="text-xl font-bold">
                  {stats?.pagosEsteMes ?? 0}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${
                (stats?.webhookErrorRate ?? 0) > 10
                  ? "bg-red-100 dark:bg-red-950"
                  : "bg-gray-100 dark:bg-gray-800"
              }`}>
                <AlertCircle className={`h-5 w-5 ${
                  (stats?.webhookErrorRate ?? 0) > 10
                    ? "text-red-600"
                    : "text-gray-600"
                }`} />
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Error webhooks (7d)</div>
                <div className={`text-xl font-bold ${
                  (stats?.webhookErrorRate ?? 0) > 10 ? "text-red-600" : ""
                }`}>
                  {stats?.webhookErrorRate ?? 0}%
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {stats?.webhookErrors ?? 0} / {stats?.webhookTotal ?? 0}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${
                (stats?.pagosPendientes ?? 0) > 0
                  ? "bg-yellow-100 dark:bg-yellow-950"
                  : "bg-gray-100 dark:bg-gray-800"
              }`}>
                <Clock className={`h-5 w-5 ${
                  (stats?.pagosPendientes ?? 0) > 0
                    ? "text-yellow-600"
                    : "text-gray-600"
                }`} />
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Pagos pendientes</div>
                <div className={`text-xl font-bold ${
                  (stats?.pagosPendientes ?? 0) > 0 ? "text-yellow-600" : ""
                }`}>
                  {stats?.pagosPendientes ?? 0}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Herramientas de diagnóstico/reconciliación */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ReconcileMpCard onReconciled={fetchPayments} />
        <WebhookEventsCard onReconcile={fetchPayments} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar organización..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-9 w-[220px]"
              />
            </div>
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
                <SelectItem value="succeeded">Exitosos</SelectItem>
                <SelectItem value="pending">Pendientes</SelectItem>
                <SelectItem value="failed">Fallidos</SelectItem>
                <SelectItem value="refunded">Reembolsados</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={providerFilter || "all"}
              onValueChange={(value) => {
                setProviderFilter(value === "all" ? "" : value)
                setPage(1)
              }}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Todos los proveedores" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los proveedores</SelectItem>
                <SelectItem value="MANUAL">Manual</SelectItem>
                <SelectItem value="MERCADOPAGO">MercadoPago</SelectItem>
                <SelectItem value="REBILL">Rebill</SelectItem>
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
            {(dateFrom || dateTo || statusFilter || providerFilter) && (
              <Button
                variant="ghost"
                onClick={() => {
                  setDateFrom("")
                  setDateTo("")
                  setStatusFilter("")
                  setProviderFilter("")
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
            data={payments}
            columns={columns}
            keyExtractor={(payment) => payment.id}
            loading={loading}
            emptyMessage="No se encontraron pagos"
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
