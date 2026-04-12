"use client"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Package } from "lucide-react"
import { formatDate } from "@/lib/utils"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import type { OrganizationUsage, MonthlyOrders } from "@/types/superadmin"

interface OrgUsageTabProps {
  usage: OrganizationUsage | null
  ordersHistory?: MonthlyOrders[]
}

const MONTH_LABELS: Record<string, string> = {
  "01": "Ene", "02": "Feb", "03": "Mar", "04": "Abr",
  "05": "May", "06": "Jun", "07": "Jul", "08": "Ago",
  "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dic",
}

function formatMonth(month: string) {
  const [, m] = month.split("-")
  return MONTH_LABELS[m] || m
}

export function OrgUsageTab({ usage, ordersHistory = [] }: OrgUsageTabProps) {
  const chartData = ordersHistory.map((item) => ({
    name: formatMonth(item.month),
    ordenes: item.count,
  }))

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Uso Actual
          </CardTitle>
          <CardDescription>
            Consumo de recursos de la organización
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 bg-muted rounded-lg text-center">
              <div className="text-3xl font-bold">
                {usage?.ordenes_mes_actual || 0}
              </div>
              <div className="text-sm text-muted-foreground">
                Órdenes este mes
              </div>
            </div>
            <div className="p-4 bg-muted rounded-lg text-center">
              <div className="text-3xl font-bold">
                {usage?.ordenes_count || 0}
              </div>
              <div className="text-sm text-muted-foreground">
                Órdenes totales
              </div>
            </div>
            <div className="p-4 bg-muted rounded-lg text-center">
              <div className="text-3xl font-bold">
                {usage?.tecnicos_count || 0}
              </div>
              <div className="text-sm text-muted-foreground">Técnicos</div>
            </div>
            <div className="p-4 bg-muted rounded-lg text-center">
              <div className="text-3xl font-bold">
                {usage?.clientes_count || 0}
              </div>
              <div className="text-sm text-muted-foreground">Clientes</div>
            </div>
          </div>

          {usage && (
            <div className="mt-4 p-4 bg-muted/50 rounded-lg">
              <div className="text-sm text-muted-foreground">
                Storage usado: {(usage.storage_used_mb || 0).toFixed(2)} MB
              </div>
              <div className="text-sm text-muted-foreground">
                Período inicio: {formatDate(usage.periodo_inicio)}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Órdenes por mes</CardTitle>
            <CardDescription>Últimos 6 meses</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[250px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="name"
                    className="text-xs fill-muted-foreground"
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    className="text-xs fill-muted-foreground"
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Bar
                    dataKey="ordenes"
                    name="Órdenes"
                    fill="hsl(var(--primary))"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
