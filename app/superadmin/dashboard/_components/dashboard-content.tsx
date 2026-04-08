"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Building2,
  Users,
  CreditCard,
  DollarSign,
  TrendingUp,
  Activity,
  AlertTriangle,
  RefreshCw,
  Clock,
  Loader2,
} from "lucide-react"
import { formatCurrency, formatDate } from "@/lib/utils"
import { useSuperadminFetch } from "@/hooks/use-superadmin-fetch"
import { DashboardCharts } from "./dashboard-charts"
import { CronPanel } from "./cron-panel"
import { AnomaliesWidget } from "./anomalies-widget"

interface RecentOrganization {
  id: string
  nombre: string
  slug: string
  activo: boolean
  created_at: string
}

interface DashboardData {
  totalOrganizations: number
  activeOrganizations: number
  totalUsers: number
  premiumSubscriptions: number
  monthlyRevenue: number
  newOrgsThisMonth: number
  recentOrganizations: RecentOrganization[]
  monthlyRevenue6m: { month: string; revenue: number }[]
  orgGrowth6m: { month: string; count: number }[]
  planDistribution: { free: number; premium: number }
  failedQueries: number
}

const AUTO_REFRESH_SECONDS = 60

export function DashboardContent() {
  const { data, loading, fetchData } = useSuperadminFetch<DashboardData>({
    showErrorToast: true,
  })
  const [secondsAgo, setSecondsAgo] = useState(0)
  const [countdown, setCountdown] = useState(AUTO_REFRESH_SECONDS)
  const lastFetchRef = useRef<number>(Date.now())
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadDashboard = useCallback(async () => {
    await fetchData("/api/superadmin/stats/dashboard")
    lastFetchRef.current = Date.now()
    setSecondsAgo(0)
    setCountdown(AUTO_REFRESH_SECONDS)
  }, [fetchData])

  // Initial load
  useEffect(() => {
    loadDashboard()
  }, [loadDashboard])

  // Timer for countdown and "seconds ago" display
  useEffect(() => {
    timerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - lastFetchRef.current) / 1000)
      setSecondsAgo(elapsed)
      setCountdown(Math.max(0, AUTO_REFRESH_SECONDS - elapsed))
    }, 1000)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  // Auto-refresh when countdown reaches 0
  useEffect(() => {
    if (countdown === 0 && !loading) {
      loadDashboard()
    }
  }, [countdown, loading, loadDashboard])

  const handleManualRefresh = () => {
    loadDashboard()
  }

  const formatSecondsAgo = (seconds: number): string => {
    if (seconds < 5) return "ahora mismo"
    if (seconds < 60) return `hace ${seconds}s`
    const mins = Math.floor(seconds / 60)
    return `hace ${mins}m`
  }

  const stats = data
    ? [
        {
          title: "Total Organizaciones",
          value: data.totalOrganizations,
          icon: Building2,
          description: `${data.activeOrganizations} activas`,
          color: "text-blue-600",
          bgColor: "bg-blue-100 dark:bg-blue-950",
        },
        {
          title: "Total Usuarios",
          value: data.totalUsers,
          icon: Users,
          description: "En todas las organizaciones",
          color: "text-green-600",
          bgColor: "bg-green-100 dark:bg-green-950",
        },
        {
          title: "Suscripciones Premium",
          value: data.premiumSubscriptions,
          icon: CreditCard,
          description: "Planes activos",
          color: "text-purple-600",
          bgColor: "bg-purple-100 dark:bg-purple-950",
        },
        {
          title: "Ingresos del Mes",
          value: formatCurrency(data.monthlyRevenue),
          icon: DollarSign,
          description: "Pagos procesados",
          color: "text-amber-600",
          bgColor: "bg-amber-100 dark:bg-amber-950",
        },
        {
          title: "Nuevas Orgs (Mes)",
          value: data.newOrgsThisMonth,
          icon: TrendingUp,
          description: "Registradas este mes",
          color: "text-cyan-600",
          bgColor: "bg-cyan-100 dark:bg-cyan-950",
        },
      ]
    : []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Panel SuperAdmin</h1>
          <p className="text-muted-foreground">
            Vista global del sistema
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            <span>
              {loading
                ? "Actualizando..."
                : `${formatSecondsAgo(secondsAgo)} \u00B7 ${countdown}s`}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleManualRefresh}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            {loading ? "Actualizando..." : "Actualizar"}
          </Button>
        </div>
      </div>

      {/* Widget de anomalías de facturación. Se auto-oculta si no hay nada. */}
      <AnomaliesWidget />

      {data && data.failedQueries > 0 && (
        <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-800 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            {data.failedQueries}{" "}
            {data.failedQueries === 1
              ? "consulta fall\u00F3"
              : "consultas fallaron"}{" "}
            al cargar. Algunos datos pueden estar incompletos.
          </span>
        </div>
      )}

      {/* Stats Grid */}
      {loading && !data ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div className="h-4 w-24 bg-muted rounded" />
                <div className="h-8 w-8 bg-muted rounded-lg" />
              </CardHeader>
              <CardContent>
                <div className="h-7 w-16 bg-muted rounded mb-1" />
                <div className="h-3 w-20 bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          {stats.map((stat) => {
            const Icon = stat.icon
            return (
              <Card
                key={stat.title}
                className="hover:shadow-md transition-shadow"
              >
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {stat.title}
                  </CardTitle>
                  <div className={`p-2 rounded-lg ${stat.bgColor}`}>
                    <Icon className={`h-4 w-4 ${stat.color}`} />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stat.value}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {stat.description}
                  </p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Charts */}
      {loading && !data ? (
        <div className="grid gap-6 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="h-5 w-40 bg-muted rounded" />
              </CardHeader>
              <CardContent>
                <div className="h-[220px] bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : data ? (
        <DashboardCharts
          monthlyRevenue6m={data.monthlyRevenue6m}
          orgGrowth6m={data.orgGrowth6m}
          planDistribution={data.planDistribution}
        />
      ) : null}

      {/* Recent Organizations & Revenue Summary */}
      {loading && !data ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="h-5 w-48 bg-muted rounded" />
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {Array.from({ length: 3 }).map((_, j) => (
                    <div
                      key={j}
                      className="h-10 bg-muted rounded border-b last:border-0"
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : data ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Organizaciones Recientes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {data.recentOrganizations.map((org) => (
                  <div
                    key={org.id}
                    className="flex items-center justify-between py-2 border-b last:border-0"
                  >
                    <div>
                      <p className="font-medium">{org.nombre}</p>
                      <p className="text-sm text-muted-foreground">
                        {org.slug}.stapp.com.ar
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant={org.activo ? "default" : "secondary"}>
                        {org.activo ? "Activa" : "Inactiva"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(org.created_at)}
                      </span>
                    </div>
                  </div>
                ))}
                {data.recentOrganizations.length === 0 && (
                  <p className="text-muted-foreground text-center py-4">
                    No hay organizaciones registradas
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                Resumen de Ingresos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between py-3 border-b">
                  <span className="text-muted-foreground">
                    Ingresos del mes
                  </span>
                  <span className="font-bold text-lg">
                    {formatCurrency(data.monthlyRevenue)}
                  </span>
                </div>
                <div className="flex items-center justify-between py-3 border-b">
                  <span className="text-muted-foreground">
                    Suscripciones Premium
                  </span>
                  <span className="font-medium">
                    {data.premiumSubscriptions}
                  </span>
                </div>
                <div className="flex items-center justify-between py-3">
                  <span className="text-muted-foreground">
                    Nuevas orgs este mes
                  </span>
                  <span className="font-medium">{data.newOrgsThisMonth}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Cron Jobs Panel */}
      <CronPanel />
    </div>
  )
}
