"use client"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Receipt } from "lucide-react"
import { formatCurrency, formatDateTime } from "@/lib/utils"
import type { PaymentWithOrg } from "@/types/superadmin"

interface OrgPaymentsTabProps {
  payments: PaymentWithOrg[]
}

export function OrgPaymentsTab({ payments }: OrgPaymentsTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Receipt className="h-5 w-5" />
          Historial de Pagos
        </CardTitle>
        <CardDescription>
          Últimos {payments.length} pagos de la organización
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 font-medium">Fecha</th>
                <th className="text-left p-3 font-medium">Monto</th>
                <th className="text-left p-3 font-medium">Estado</th>
                <th className="text-left p-3 font-medium">Proveedor</th>
                <th className="text-left p-3 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id} className="border-b last:border-0">
                  <td className="p-3">
                    {payment.paid_at
                      ? formatDateTime(payment.paid_at)
                      : formatDateTime(payment.created_at)}
                  </td>
                  <td className="p-3 font-medium">
                    {formatCurrency(payment.amount)}
                  </td>
                  <td className="p-3">
                    <Badge
                      variant={
                        payment.status === "SUCCEEDED"
                          ? "default"
                          : payment.status === "PENDING"
                            ? "secondary"
                            : "destructive"
                      }
                    >
                      {payment.status}
                    </Badge>
                  </td>
                  <td className="p-3">{payment.payment_provider || "-"}</td>
                  <td className="p-3">
                    {payment.receipt_url && (
                      <a
                        href={payment.receipt_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline text-xs"
                      >
                        Ver recibo
                      </a>
                    )}
                  </td>
                </tr>
              ))}
              {payments.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground">
                    No hay pagos registrados
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
