import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ClipboardList, Users, Package, DollarSign, Shield } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import { redirect } from "next/navigation"
import Link from "next/link"
import { DolarWidget } from "@/components/cotizacion-dolar"
import {
  OrdenesRecientes,
  DashboardCharts,
} from "@/components/dashboard"
import { unstable_cache } from "next/cache"

// Cachear datos del dashboard por 2 minutos
const getDashboardData = unstable_cache(
  async (organizationId: string) => {
    const hoy = new Date()
    const enSieteDias = new Date()
    enSieteDias.setDate(enSieteDias.getDate() + 7)
    const primerDiaMes = new Date(new Date().setDate(1))
    const hace7Dias = new Date()
    hace7Dias.setDate(hace7Dias.getDate() - 7)

    const [
      totalOrdenesResult,
      ordenesPendientesResult,
      totalClientesResult,
      itemsBajoStockResult,
      ingresosMensualesResult,
      garantiasPorVencerResult,
      ordenesPorEstadoResult,
      ingresosUltimos7DiasResult,
      ordenesRecientesResult,
      ordenesPorTecnicoResult,
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
      supabaseAdmin
        .from("ordenes_servicio")
        .select("estado")
        .eq("organization_id", organizationId),
      supabaseAdmin
        .from("facturas")
        .select("total, fecha, ordenes_servicio!inner(organization_id)")
        .eq("ordenes_servicio.organization_id", organizationId)
        .eq("estado_pago", "PAGADO")
        .gte("fecha", hace7Dias.toISOString())
        .order("fecha", { ascending: true }),
      supabaseAdmin
        .from("ordenes_servicio")
        .select(`
          id, numero_orden, codigo_orden, dispositivo, estado, fecha_ingreso,
          clientes (nombre)
        `)
        .eq("organization_id", organizationId)
        .order("fecha_ingreso", { ascending: false })
        .limit(5),
      supabaseAdmin
        .from("ordenes_servicio")
        .select(`
          tecnico_id, estado,
          usuarios!ordenes_servicio_tecnico_id_fkey (nombre)
        `)
        .eq("organization_id", organizationId)
        .not("tecnico_id", "is", null)
        .in("estado", ["RECIBIDO", "EN_DIAGNOSTICO", "PRESUPUESTADO", "APROBADO", "EN_REPARACION", "ESPERANDO_REPUESTO", "REPARADO"]),
    ])

    return {
      totalOrdenesResult,
      ordenesPendientesResult,
      totalClientesResult,
      itemsBajoStockResult,
      ingresosMensualesResult,
      garantiasPorVencerResult,
      ordenesPorEstadoResult,
      ingresosUltimos7DiasResult,
      ordenesRecientesResult,
      ordenesPorTecnicoResult,
      hace7Dias: hace7Dias.toISOString(),
    }
  },
  ["dashboard-data"],
  { revalidate: 120, tags: ["dashboard"] }
)

export default async function DashboardPage() {
  const session = await auth()
  if (!session) {
    redirect("/login")
  }

  const organizationId = session.user.organizationId

  // Obtener datos del dashboard con caché (2 minutos)
  const {
    totalOrdenesResult,
    ordenesPendientesResult,
    totalClientesResult,
    itemsBajoStockResult,
    ingresosMensualesResult,
    garantiasPorVencerResult,
    ordenesPorEstadoResult,
    ingresosUltimos7DiasResult,
    ordenesRecientesResult,
    ordenesPorTecnicoResult,
    hace7Dias,
  } = await getDashboardData(organizationId)

  // Procesar datos básicos
  const totalOrdenes = totalOrdenesResult.count || 0
  const ordenesPendientes = ordenesPendientesResult.count || 0
  const totalClientes = totalClientesResult.count || 0
  const itemsBajoStock = itemsBajoStockResult.count || 0
  const facturasData = ingresosMensualesResult.data as { total: number }[] | null
  const ingresos = facturasData?.reduce((sum, f) => sum + (f.total || 0), 0) || 0
  const garantiasPorVencer = garantiasPorVencerResult.data || []

  // Procesar órdenes por estado
  const ordenesPorEstado = {
    RECIBIDO: 0,
    EN_DIAGNOSTICO: 0,
    PRESUPUESTADO: 0,
    APROBADO: 0,
    EN_REPARACION: 0,
    ESPERANDO_REPUESTO: 0,
    REPARADO: 0,
    ENTREGADO: 0,
    CANCELADO: 0,
    SIN_REPARACION: 0,
  }
  ordenesPorEstadoResult.data?.forEach((orden: { estado: string }) => {
    if (orden.estado in ordenesPorEstado) {
      ordenesPorEstado[orden.estado as keyof typeof ordenesPorEstado]++
    }
  })

  // Procesar ingresos últimos 7 días
  const ingresosMap: Record<string, number> = {}
  // Inicializar los últimos 7 días con 0
  for (let i = 6; i >= 0; i--) {
    const fecha = new Date()
    fecha.setDate(fecha.getDate() - i)
    const key = fecha.toISOString().split("T")[0]
    ingresosMap[key] = 0
  }
  // Sumar los ingresos
  ingresosUltimos7DiasResult.data?.forEach((factura: { total: number; fecha: string }) => {
    const key = new Date(factura.fecha).toISOString().split("T")[0]
    if (key in ingresosMap) {
      ingresosMap[key] += factura.total || 0
    }
  })
  const ingresosUltimos7Dias = Object.entries(ingresosMap).map(([fecha, total]) => ({
    fecha,
    total,
  }))
  const totalIngresos7Dias = ingresosUltimos7Dias.reduce((sum, d) => sum + d.total, 0)

  // Procesar órdenes recientes
  const ordenesRecientes = (ordenesRecientesResult.data || []).map((orden: any) => ({
    id: orden.id,
    numeroOrden: orden.numero_orden,
    codigoOrden: orden.codigo_orden,
    cliente: orden.clientes?.nombre || "Sin cliente",
    dispositivo: orden.dispositivo,
    estado: orden.estado,
    fechaIngreso: orden.fecha_ingreso,
  }))

  // Procesar órdenes por técnico
  const tecnicosMap: Record<string, { nombre: string; ordenes: number; completadas: number }> = {}
  ordenesPorTecnicoResult.data?.forEach((orden: any) => {
    const tecnicoId = orden.tecnico_id
    const nombre = orden.usuarios?.nombre || "Sin nombre"
    if (!tecnicosMap[tecnicoId]) {
      tecnicosMap[tecnicoId] = { nombre, ordenes: 0, completadas: 0 }
    }
    if (orden.estado === "REPARADO" || orden.estado === "ENTREGADO") {
      tecnicosMap[tecnicoId].completadas++
    } else {
      tecnicosMap[tecnicoId].ordenes++
    }
  })
  const ordenesPorTecnico = Object.values(tecnicosMap)

  const stats = [
    {
      title: "Órdenes Totales",
      value: totalOrdenes.toString(),
      description: `${ordenesPendientes} pendientes`,
      icon: ClipboardList,
      colorClass: "text-info-600 dark:text-info-500",
      bgClass: "bg-info-50 dark:bg-info-100/50",
    },
    {
      title: "Clientes",
      value: totalClientes.toString(),
      description: "Total registrados",
      icon: Users,
      colorClass: "text-success-600 dark:text-success-500",
      bgClass: "bg-success-50 dark:bg-success-100/50",
    },
    {
      title: "Bajo Stock",
      value: itemsBajoStock.toString(),
      description: "Items a reponer",
      icon: Package,
      colorClass: "text-warning-600 dark:text-warning-500",
      bgClass: "bg-warning-50 dark:bg-warning-100/50",
    },
    {
      title: "Ingresos del Mes",
      value: formatCurrency(ingresos),
      description: "Facturas pagadas",
      icon: DollarSign,
      colorClass: "text-purple-600 dark:text-purple-400",
      bgClass: "bg-purple-50 dark:bg-purple-900/30",
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

      {/* Stats Cards */}
      <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <Card key={stat.title} className="transition-shadow hover:shadow-md">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 sm:p-6 pb-1 sm:pb-2">
                <CardTitle className="text-xs sm:text-sm font-medium text-foreground">
                  {stat.title}
                </CardTitle>
                <div className={`p-1.5 sm:p-2 rounded-lg ${stat.bgClass}`}>
                  <Icon className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${stat.colorClass}`} />
                </div>
              </CardHeader>
              <CardContent className="p-3 sm:p-6 pt-0">
                <div className="text-lg sm:text-2xl font-bold text-foreground">{stat.value}</div>
                <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 sm:mt-1">
                  {stat.description}
                </p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Gráficos con lazy loading (Recharts) + Órdenes recientes */}
      <DashboardCharts
        ordenesPorEstado={ordenesPorEstado}
        ingresosUltimos7Dias={ingresosUltimos7Dias}
        totalIngresos7Dias={totalIngresos7Dias}
        ordenesPorTecnico={ordenesPorTecnico}
      >
        <OrdenesRecientes ordenes={ordenesRecientes} />
      </DashboardCharts>

      {/* Tercera fila: Alertas y Widget Dólar */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Alertas</CardTitle>
            <CardDescription>Notificaciones importantes</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {garantiasPorVencer.length > 0 && (
              <div className="p-3 bg-warning-50 dark:bg-warning-100/40 border border-warning/30 dark:border-warning/20 rounded-lg">
                <div className="flex items-center gap-2 text-warning-700 dark:text-warning-500 font-medium">
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
                        className="block text-sm text-warning-700 dark:text-warning-600 hover:underline"
                      >
                        Orden #{g.ordenes_servicio.numero_orden} - {g.ordenes_servicio.clientes?.nombre}
                        <span className="text-warning-600 dark:text-warning-500 ml-1">
                          ({diasRestantes} día{diasRestantes !== 1 ? "s" : ""})
                        </span>
                      </Link>
                    )
                  })}
                  {garantiasPorVencer.length > 3 && (
                    <p className="text-xs text-warning-600 dark:text-warning-500">
                      y {garantiasPorVencer.length - 3} más...
                    </p>
                  )}
                </div>
              </div>
            )}
            {itemsBajoStock > 0 && (
              <Link href="/inventario" className="block">
                <div className="p-3 bg-warning-50 dark:bg-warning-100/40 border border-warning/30 dark:border-warning/20 rounded-lg hover:bg-warning-100 dark:hover:bg-warning-200/40 transition-colors">
                  <div className="flex items-center gap-2 text-warning-700 dark:text-warning-500">
                    <Package className="h-4 w-4" />
                    {itemsBajoStock} items con stock bajo
                  </div>
                </div>
              </Link>
            )}
            {ordenesPendientes > 0 && (
              <Link href="/ordenes?estado=pendientes" className="block">
                <div className="p-3 bg-info-50 dark:bg-info-100/40 border border-info/30 dark:border-info/20 rounded-lg hover:bg-info-100 dark:hover:bg-info-200/40 transition-colors">
                  <div className="flex items-center gap-2 text-info-700 dark:text-info-500">
                    <ClipboardList className="h-4 w-4" />
                    {ordenesPendientes} órdenes pendientes
                  </div>
                </div>
              </Link>
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
