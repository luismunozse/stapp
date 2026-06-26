"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ExternalLink, Receipt } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"

interface Payment {
  id: string
  amount: number
  currency: string
  status: string
  payment_provider: string
  invoice_url?: string
  receipt_url?: string
  paid_at: string
}

interface PaymentHistoryProps {
  payments: Payment[]
}

export function PaymentHistory({ payments }: PaymentHistoryProps) {
  const { timezone } = useCurrency()
  const statusColors: Record<string, string> = {
    SUCCEEDED: "bg-green-100 text-green-800",
    PENDING: "bg-yellow-100 text-yellow-800",
    FAILED: "bg-red-100 text-red-800",
    REFUNDED: "bg-gray-100 text-gray-800",
  }

  const statusLabels: Record<string, string> = {
    SUCCEEDED: "Pagado",
    PENDING: "Pendiente",
    FAILED: "Fallido",
    REFUNDED: "Reembolsado",
  }

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency: currency || "USD",
    }).format(amount)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("es-ES", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: timezone,
    })
  }

  if (payments.length === 0) {
    return (
      <Card>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="text-base sm:text-lg">Historial de Pagos</CardTitle>
          <CardDescription className="text-xs sm:text-sm">Tus pagos y facturas</CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0">
          <div className="text-center py-6 sm:py-8 text-muted-foreground">
            <Receipt className="h-10 w-10 sm:h-12 sm:w-12 mx-auto mb-3 sm:mb-4 opacity-50" />
            <p className="text-sm">No hay pagos registrados</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="p-4 sm:p-6">
        <CardTitle className="text-base sm:text-lg">Historial de Pagos</CardTitle>
        <CardDescription className="text-xs sm:text-sm">Tus pagos y facturas</CardDescription>
      </CardHeader>
      <CardContent className="p-4 sm:p-6 pt-0">
        <div className="space-y-3 sm:space-y-4">
          {payments.map((payment) => (
            <div
              key={payment.id}
              className="flex items-center justify-between py-2 sm:py-3 border-b last:border-0 gap-2"
            >
              <div className="flex items-center gap-2 sm:gap-4 min-w-0">
                <div className="h-8 w-8 sm:h-10 sm:w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Receipt className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">
                    {formatCurrency(payment.amount, payment.currency)}
                  </p>
                  <p className="text-[10px] sm:text-sm text-muted-foreground truncate">
                    {formatDate(payment.paid_at)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 sm:gap-3 shrink-0">
                <Badge className={`text-[10px] sm:text-xs ${statusColors[payment.status]}`}>
                  {statusLabels[payment.status]}
                </Badge>
                {(payment.invoice_url || payment.receipt_url) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    asChild
                    className="h-8 w-8 p-0"
                  >
                    <a
                      href={payment.invoice_url || payment.receipt_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
