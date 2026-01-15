import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ClipboardList, Users, Package, DollarSign, Shield } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import { redirect } from "next/navigation"
import Link from "next/link"
import { DolarWidget } from "@/components/cotizacion-dolar"

export default async function DashboardPage() {
  const session = await auth()
  if (!session) {
    redirect("/login")
  }

  const organizationId = session.user.organizationId

  // Calcular fechas para garantías por vencer
  const hoy = new Date()
  const enSieteDias = new Date()
  enSieteDias.setDate(enSieteDias.getDate() + 7)
  const primerDiaMes = new Date(new Date().setDate(1))

  // Ejecutar queries en paralelo
  const [
    totalOrdenesResult,
    ordenesPendientesResult,
    totalClientesResult,
    itemsBajoStockResult,
    ingresosMensualesResult,
    garantiasPorVencerResult,
  ] = await Promise.all([
    supabaseAdmin
      .from("ordenes_servicio")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId),
    supabaseAdmin
      .from("ordenes_servicio")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .in("estado", ["RECIBIDO", "EN_DIAGNOSTICO", "PRESUPUESTADO", "APROBADO", "EN_REPARACION", "ESPERANDO_REPUESTO"]),
    supabaseAdmin
      .from("clientes")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId),
    supabaseAdmin
      .from("inventario")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .lt("stock", 5),
    supabaseAdmin
      .from("facturas")
      .select("total, ordenes_servicio!inner(organization_id)")
      .eq("ordenes_servicio.organization_id", organizationId)
      .eq("estado_pago", "PAGADO")
      .gte("fecha", primerDiaMes.toISOString()),
    supabaseAdmin
      .from("garantias")
      .select(`
        id, orden_id, fecha_vencimiento,
        ordenes_servicio!inner (
          id, numero_orden, organization_id,
          clientes (nombre)
        )
      `)
      .eq("ordenes_servicio.organization_id", organizationId)
      .eq("estado", "ACTIVA")
      .gte("fecha_vencimiento", hoy.toISOString())
      .lte("fecha_vencimiento", enSieteDias.toISOString())
      .order("fecha_vencimiento", { ascending: true }),
  ])

  const totalOrdenes = totalOrdenesResult.count || 0
  const ordenesPendientes = ordenesPendientesResult.count || 0
  const totalClientes = totalClientesResult.count || 0
  const itemsBajoStock = itemsBajoStockResult.count || 0
  const facturasData = ingresosMensualesResult.data as { total: number }[] | null
  const ingresos = facturasData?.reduce((sum, f) => sum + (f.total || 0), 0) || 0
  const garantiasPorVencer = garantiasPorVencerResult.data || []

  const stats = [
    {
      title: "Órdenes Totales",
      value: totalOrdenes.toString(),
      description: `${ordenesPendientes} pendientes`,
      icon: ClipboardList,
      colorClass: "text-info",
      bgClass: "bg-info-50 dark:bg-info-100",
    },
    {
      title: "Clientes",
      value: totalClientes.toString(),
      description: "Total registrados",
      icon: Users,
      colorClass: "text-success",
      bgClass: "bg-success-50 dark:bg-success-100",
    },
    {
      title: "Bajo Stock",
      value: itemsBajoStock.toString(),
      description: "Items a reponer",
      icon: Package,
      colorClass: "text-warning-600",
      bgClass: "bg-warning-50 dark:bg-warning-100",
    },
    {
      title: "Ingresos del Mes",
      value: formatCurrency(ingresos),
      description: "Facturas pagadas",
      icon: DollarSign,
      colorClass: "text-purple-600 dark:text-purple-400",
      bgClass: "bg-purple-50 dark:bg-purple-900/20",
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-headline">Dashboard</h1>
        <p className="text-muted-foreground">
          Bienvenido, {session.user?.name || "Usuario"}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <Card key={stat.title} className="transition-shadow hover:shadow-md">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {stat.title}
                </CardTitle>
                <div className={`p-2 rounded-lg ${stat.bgClass}`}>
                  <Icon className={`h-4 w-4 ${stat.colorClass}`} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
                <p className="text-caption mt-1">
                  {stat.description}
                </p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Órdenes Recientes</CardTitle>
            <CardDescription>Últimas órdenes de servicio</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Lista de órdenes recientes aparecerá aquí
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Alertas</CardTitle>
            <CardDescription>Notificaciones importantes</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {garantiasPorVencer.length > 0 && (
              <div className="p-3 bg-warning-50 dark:bg-warning-100 border border-warning/30 rounded-lg">
                <div className="flex items-center gap-2 text-warning-700 dark:text-warning-600 font-medium">
                  <Shield className="h-4 w-4" />
                  {garantiasPorVencer.length} garantía{garantiasPorVencer.length > 1 ? "s" : ""} por vencer
                </div>
                <div className="mt-2 space-y-1">
                  {garantiasPorVencer.slice(0, 3).map((g: any) => {
                    const diasRestantes = Math.ceil(
                      (new Date(g.fecha_vencimiento).getTime() - new Date().getTime()) /
                        (1000 * 60 * 60 * 24)
                    )
                    return (
                      <Link
                        key={g.id}
                        href={`/ordenes/${g.orden_id}`}
                        className="block text-sm text-warning-600 hover:underline"
                      >
                        Orden #{g.ordenes_servicio.numero_orden} - {g.ordenes_servicio.clientes?.nombre}
                        <span className="text-warning-500 ml-1">
                          ({diasRestantes} día{diasRestantes !== 1 ? "s" : ""})
                        </span>
                      </Link>
                    )
                  })}
                  {garantiasPorVencer.length > 3 && (
                    <p className="text-xs text-warning-500">
                      y {garantiasPorVencer.length - 3} más...
                    </p>
                  )}
                </div>
              </div>
            )}
            {itemsBajoStock > 0 && (
              <div className="p-3 bg-warning-50 dark:bg-warning-100 border border-warning/30 rounded-lg">
                <div className="flex items-center gap-2 text-warning-700 dark:text-warning-600">
                  <Package className="h-4 w-4" />
                  {itemsBajoStock} items con stock bajo
                </div>
              </div>
            )}
            {ordenesPendientes > 0 && (
              <div className="p-3 bg-info-50 dark:bg-info-100 border border-info/30 rounded-lg">
                <div className="flex items-center gap-2 text-info-700 dark:text-info-600">
                  <ClipboardList className="h-4 w-4" />
                  {ordenesPendientes} órdenes pendientes
                </div>
              </div>
            )}
            {garantiasPorVencer.length === 0 && itemsBajoStock === 0 && ordenesPendientes === 0 && (
              <p className="text-sm text-muted-foreground">
                No hay alertas pendientes
              </p>
            )}
          </CardContent>
        </Card>
        <DolarWidget />
      </div>
    </div>
  )
}
