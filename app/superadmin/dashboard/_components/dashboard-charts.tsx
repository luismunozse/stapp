"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TrendingUp, Building2, CreditCard } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts"

interface MonthlyRevenue {
  month: string
  revenue: number
}

interface OrgGrowth {
  month: string
  count: number
}

interface PlanDistribution {
  free: number
  premium: number
}

interface DashboardChartsProps {
  monthlyRevenue6m: MonthlyRevenue[]
  orgGrowth6m: OrgGrowth[]
  planDistribution: PlanDistribution
}

const PLAN_COLORS = ["#8b5cf6", "#06b6d4"] // purple for premium, cyan for free

export function DashboardCharts({
  monthlyRevenue6m,
  orgGrowth6m,
  planDistribution,
}: DashboardChartsProps) {
  const planData = [
    { name: "Premium", value: planDistribution.premium },
    { name: "Free", value: planDistribution.free },
  ]

  const totalPlans = planDistribution.free + planDistribution.premium

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Monthly Revenue Chart */}
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <div className="p-1.5 rounded-lg bg-amber-100 dark:bg-amber-950">
              <TrendingUp className="h-4 w-4 text-amber-600" />
            </div>
            Ingresos Mensuales
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyRevenue6m} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11 }}
                  className="fill-muted-foreground"
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  className="fill-muted-foreground"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  formatter={(value: number) => [formatCurrency(value), "Ingresos"]}
                  contentStyle={{
                    backgroundColor: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "12px",
                    color: "hsl(var(--popover-foreground))",
                  }}
                />
                <Bar dataKey="revenue" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Org Growth Chart */}
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <div className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-950">
              <Building2 className="h-4 w-4 text-blue-600" />
            </div>
            Crecimiento de Organizaciones
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={orgGrowth6m} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11 }}
                  className="fill-muted-foreground"
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  className="fill-muted-foreground"
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  formatter={(value: number) => [value, "Organizaciones"]}
                  contentStyle={{
                    backgroundColor: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "12px",
                    color: "hsl(var(--popover-foreground))",
                  }}
                />
                <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Plan Distribution Pie Chart */}
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <div className="p-1.5 rounded-lg bg-purple-100 dark:bg-purple-950">
              <CreditCard className="h-4 w-4 text-purple-600" />
            </div>
            Distribución de Planes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[220px] flex items-center justify-center">
            {totalPlans === 0 ? (
              <p className="text-sm text-muted-foreground">Sin suscripciones activas</p>
            ) : (
              <div className="flex items-center gap-6 w-full">
                <div className="flex-1">
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie
                        data={planData}
                        cx="50%"
                        cy="50%"
                        innerRadius={45}
                        outerRadius={75}
                        paddingAngle={3}
                        dataKey="value"
                        strokeWidth={0}
                      >
                        {planData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={PLAN_COLORS[index]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: number, name: string) => [value, name]}
                        contentStyle={{
                          backgroundColor: "hsl(var(--popover))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: "12px",
                          color: "hsl(var(--popover-foreground))",
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-3 shrink-0">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: PLAN_COLORS[0] }} />
                    <div>
                      <p className="text-sm font-medium">Premium</p>
                      <p className="text-xs text-muted-foreground">
                        {planDistribution.premium} ({totalPlans > 0 ? Math.round((planDistribution.premium / totalPlans) * 100) : 0}%)
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: PLAN_COLORS[1] }} />
                    <div>
                      <p className="text-sm font-medium">Free</p>
                      <p className="text-xs text-muted-foreground">
                        {planDistribution.free} ({totalPlans > 0 ? Math.round((planDistribution.free / totalPlans) * 100) : 0}%)
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
