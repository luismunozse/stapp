import { redirect } from "next/navigation"
import { getSuperadminSession } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Building2,
  Users,
  CreditCard,
  DollarSign,
  TrendingUp,
  Activity,
} from "lucide-react"
import { formatCurrency, formatDate } from "@/lib/utils"

export default async function SuperadminDashboard() {
  const session = await getSuperadminSession()
  if (!session) redirect("/superadmin-login")

  const primerDiaMes = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1
  )

  const [
    totalOrgsResult,
    activeOrgsResult,
    totalUsersResult,
    premiumSubscriptionsResult,
    monthlyRevenueResult,
    newOrgsThisMonthResult,
    recentOrgsResult,
  ] = await Promise.all([
    supabaseAdmin
      .from("organizations")
      .select("id", { count: "exact", head: true }),
    supabaseAdmin
      .from("organizations")
      .select("id", { count: "exact", head: true })
      .eq("activo", true),
    supabaseAdmin.from("users").select("id", { count: "exact", head: true }),
    supabaseAdmin
      .from("subscriptions")
      .select("id, plans!inner(tipo)", { count: "exact", head: true })
      .eq("status", "ACTIVE")
      .eq("plans.tipo", "PREMIUM"),
    supabaseAdmin
      .from("subscription_payments")
      .select("amount")
      .eq("status", "SUCCEEDED")
      .gte("paid_at", primerDiaMes.toISOString()),
    supabaseAdmin
      .from("organizations")
      .select("id", { count: "exact", head: true })
      .gte("created_at", primerDiaMes.toISOString()),
    supabaseAdmin
      .from("organizations")
      .select("id, nombre, slug, activo, created_at")
      .order("created_at", { ascending: false })
      .limit(5),
  ])

  const monthlyRevenue =
    monthlyRevenueResult.data?.reduce((s, p) => s + (p.amount || 0), 0) || 0

  const stats = [
    {
      title: "Total Organizaciones",
      value: totalOrgsResult.count || 0,
      icon: Building2,
      description: `${activeOrgsResult.count || 0} activas`,
      color: "text-blue-600",
      bgColor: "bg-blue-100 dark:bg-blue-950",
    },
    {
      title: "Total Usuarios",
      value: totalUsersResult.count || 0,
      icon: Users,
      description: "En todas las organizaciones",
      color: "text-green-600",
      bgColor: "bg-green-100 dark:bg-green-950",
    },
    {
      title: "Suscripciones Premium",
      value: premiumSubscriptionsResult.count || 0,
      icon: CreditCard,
      description: "Planes activos",
      color: "text-purple-600",
      bgColor: "bg-purple-100 dark:bg-purple-950",
    },
    {
      title: "Ingresos del Mes",
      value: formatCurrency(monthlyRevenue),
      icon: DollarSign,
      description: "Pagos procesados",
      color: "text-amber-600",
      bgColor: "bg-amber-100 dark:bg-amber-950",
    },
    {
      title: "Nuevas Orgs (Mes)",
      value: newOrgsThisMonthResult.count || 0,
      icon: TrendingUp,
      description: "Registradas este mes",
      color: "text-cyan-600",
      bgColor: "bg-cyan-100 dark:bg-cyan-950",
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Panel SuperAdmin</h1>
        <p className="text-muted-foreground">
          Vista global del sistema - {session.user?.email}
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <Card key={stat.title} className="hover:shadow-md transition-shadow">
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

      {/* Recent Organizations */}
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
              {recentOrgsResult.data?.map((org) => (
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
              {(!recentOrgsResult.data || recentOrgsResult.data.length === 0) && (
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
                <span className="text-muted-foreground">Ingresos del mes</span>
                <span className="font-bold text-lg">
                  {formatCurrency(monthlyRevenue)}
                </span>
              </div>
              <div className="flex items-center justify-between py-3 border-b">
                <span className="text-muted-foreground">
                  Suscripciones Premium
                </span>
                <span className="font-medium">
                  {premiumSubscriptionsResult.count || 0}
                </span>
              </div>
              <div className="flex items-center justify-between py-3">
                <span className="text-muted-foreground">
                  Nuevas orgs este mes
                </span>
                <span className="font-medium">
                  {newOrgsThisMonthResult.count || 0}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
