"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { DataTable, Column } from "@/components/ui/data-table"
import { Receipt, Eye, ExternalLink, DollarSign } from "lucide-react"
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils"
import type { PaymentWithOrg } from "@/types/superadmin"

export default function PagosPage() {
  const router = useRouter()
  const [payments, setPayments] = useState<PaymentWithOrg[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalAmount, setTotalAmount] = useState(0)

  const fetchPayments = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: "20",
        ...(statusFilter && { status: statusFilter }),
        ...(dateFrom && { dateFrom }),
        ...(dateTo && { dateTo }),
      })

      const res = await fetch(`/api/superadmin/payments?${params}`)
      if (!res.ok) throw new Error("Error fetching payments")

      const data = await res.json()
      setPayments(data.payments || [])
      setTotal(data.total || 0)
      setTotalAmount(data.totalAmount || 0)
    } catch (error) {
      console.error("Error:", error)
    } finally {
      setLoading(false)
    }
  }, [page, statusFilter, dateFrom, dateTo])

  useEffect(() => {
    fetchPayments()
  }, [fetchPayments])

  const getStatusVariant = (status: string) => {
    switch (status) {
      case "SUCCEEDED":
        return "default"
      case "PENDING":
        return "secondary"
      case "FAILED":
        return "destructive"
      case "REFUNDED":
        return "warning" as "default"
      default:
        return "secondary"
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
      key: "amount",
      header: "Monto",
      render: (payment) => (
        <span className="font-medium">{formatCurrency(payment.amount)}</span>
      ),
    },
    {
      key: "status",
      header: "Estado",
      render: (payment) => (
        <Badge variant={getStatusVariant(payment.status)}>{payment.status}</Badge>
      ),
    },
    {
      key: "payment_provider",
      header: "Proveedor",
      render: (payment) => payment.payment_provider || "-",
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
          {payment.receipt_url && (
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
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Receipt className="h-8 w-8" />
          Pagos
        </h1>
        <p className="text-muted-foreground">
          Historial de pagos de todas las organizaciones
        </p>
      </div>

      {/* Stats Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-green-100 dark:bg-green-950 rounded-lg">
              <DollarSign className="h-6 w-6 text-green-600" />
            </div>
            <div>
              <div className="text-sm text-muted-foreground">
                Total en el período seleccionado
              </div>
              <div className="text-2xl font-bold">
                {formatCurrency(totalAmount)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

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
                <SelectItem value="succeeded">Exitosos</SelectItem>
                <SelectItem value="pending">Pendientes</SelectItem>
                <SelectItem value="failed">Fallidos</SelectItem>
                <SelectItem value="refunded">Reembolsados</SelectItem>
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
            {(dateFrom || dateTo || statusFilter) && (
              <Button
                variant="ghost"
                onClick={() => {
                  setDateFrom("")
                  setDateTo("")
                  setStatusFilter("")
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
