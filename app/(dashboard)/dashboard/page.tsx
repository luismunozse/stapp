import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ClipboardList, Users, Package, DollarSign, Shield, ShoppingCart, TrendingUp } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import type { CurrencyCode } from "@/lib/currency"
import { redirect } from "next/navigation"
import Link from "next/link"
import { DolarWidget } from "@/components/cotizacion-dolar"
import {
  OrdenesRecientes,
  DashboardCharts,
} from "@/components/dashboard"
import { WhatsNewModal } from "@/components/whats-new-modal"
import { NpsSurvey } from "@/components/nps-survey"
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
      ventasHoyResult,
      ventasMesResult,
      garantiasVentaPorVencerResult,
      ordenesPorTecnicoResult,
      ordenesPendienteCobroResult,
      ordenesFechaVencidaResult,
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
      // Ventas de hoy
      supabaseAdmin
        .from("ventas")
        .select("id, total")
        .eq("organization_id", organizationId)
        .eq("estado", "COMPLETADA")
        .gte("created_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),

      // Ventas del mes
      supabaseAdmin
        .from("ventas")
        .select("id, total")
        .eq("organization_id", organizationId)
        .eq("estado", "COMPLETADA")
        .gte("created_at", primerDiaMes.toISOString()),

      // Garantías de venta por vencer (próximos 7 días)
      supabaseAdmin
        .from("garantias_venta")
        .select("id, numero_garantia, fecha_vencimiento, items_venta!inner(descripcion), ventas!inner(numero_venta, cliente_nombre, organization_id)")
        .eq("organization_id", organizationId)
        .eq("estado", "ACTIVA")
        .gte("fecha_vencimiento", hoy.toISOString())
        .lte("fecha_vencimiento", enSieteDias.toISOString())
        .order("fecha_vencimiento", { ascending: true }),

      supabaseAdmin
        .from("ordenes_servicio")
        .select(`
          tecnico_id, estado,
          users!ordenes_servicio_tecnico_id_fkey (nombre)
        `)
        .eq("organization_id", organizationId)
        .not("tecnico_id", "is", null)
        .in("estado", ["RECIBIDO", "EN_DIAGNOSTICO", "PRESUPUESTADO", "APROBADO", "EN_REPARACION", "ESPERANDO_REPUESTO", "REPARADO"]),
      // Órdenes con cobro pendiente (para antigüedad de deuda)
      supabaseAdmin
        .from("ordenes_servicio")
        .select(`
          id, numero_orden, codigo_orden, costo_final, total_cobrado, descuento_cobro,
          estado_cobro, fecha_ingreso, estado,
          clientes (nombre)
        `)
        .eq("organization_id", organizationId)
        .in("estado_cobro", ["PENDIENTE", "PARCIAL"])
        .in("estado", ["REPARADO", "ENTREGADO"])
        .gt("costo_final", 0),
      // Órdenes con fecha prometida vencida
      supabaseAdmin
        .from("ordenes_servicio")
        .select(`
          id, numero_orden, codigo_orden, dispositivo, estado, fecha_prometida,
          clientes (nombre)
        `)
        .eq("organization_id", organizationId)
        .in("estado", ["RECIBIDO", "EN_DIAGNOSTICO", "PRESUPUESTADO", "APROBADO", "EN_REPARACION", "ESPERANDO_REPUESTO"])
        .lt("fecha_prometida", hoy.toISOString())
        .not("fecha_prometida", "is", null),
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
      ventasHoyResult,
      ventasMesResult,
      garantiasVentaPorVencerResult,
      ordenesPorTecnicoResult,
      ordenesPendienteCobroResult,
      ordenesFechaVencidaResult,
      hace7Dias: hace7Dias.toISOString(),
    }
  },
  ["dashboard-data"],
  { revalidate: 120, tags: ["dashboard"] }
)

export default async function DashboardPage() {
  const session = await auth()
  if (!session || !session.user?.organizationId) {
    redirect("/login")
  }

  const organizationId = session.user.organizationId
  const userRole = session.user.role || "TECNICO"
  const userId = session.user.id
  const isAdmin = userRole === "ADMIN"
  const isVendedor = userRole === "VENDEDOR"
  const isTecnico = userRole === "TECNICO"

  // Obtener la última versión vista por el usuario (sin caché, es por usuario)
  const { data: userData } = await supabaseAdmin
    .from("users")
    .select("last_seen_version")
    .eq("id", session.user.id)
    .single()
  const lastSeenVersion: string | null = userData?.last_seen_version ?? null

  // Obtener moneda de la organización y estado de onboarding
  const { data: orgData } = await supabaseAdmin
    .from("organizations")
    .select("moneda, zona_horaria, onboarding_completed")
    .eq("id", organizationId)
    .single()
  const moneda = (orgData?.moneda || "ARS") as CurrencyCode

  // Redirect a onboarding si no fue completado (solo para admins con < 5 órdenes)
  if (orgData && orgData.onboarding_completed === false && session.user?.role === "ADMIN") {
    const { count: orderCount } = await supabaseAdmin
      .from("ordenes_servicio")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)

    if ((orderCount ?? 0) < 5) {
      redirect("/onboarding")
    } else {
      // Si ya tienen 5+ órdenes, marcar onboarding como completado automáticamente
      await supabaseAdmin
        .from("organizations")
        .update({ onboarding_completed: true })
        .eq("id", organizationId)
    }
  }

  // Datos específicos por rol (sin caché, por usuario)
  let misOrdenesActivas = 0
  let misOrdenesCompletadas = 0
  let misVentasHoyTotal = 0
  let misVentasHoyCount = 0
  let misVentasMesTotal = 0
  let misVentasMesCount = 0

  if (isTecnico) {
    const primerDiaMes = new Date(new Date().setDate(1))
    const [activas, completadas] = await Promise.all([
      supabaseAdmin
        .from("ordenes_servicio")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("tecnico_id", userId)
        .in("estado", ["RECIBIDO", "EN_DIAGNOSTICO", "PRESUPUESTADO", "APROBADO", "EN_REPARACION", "ESPERANDO_REPUESTO"]),
      supabaseAdmin
        .from("ordenes_servicio")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("tecnico_id", userId)
        .in("estado", ["REPARADO", "ENTREGADO"])
        .gte("fecha_ingreso", primerDiaMes.toISOString()),
    ])
    misOrdenesActivas = activas.count || 0
    misOrdenesCompletadas = completadas.count || 0
  }

  if (isVendedor) {
    const primerDiaMes = new Date(new Date().setDate(1))
    const hoyInicio = new Date(new Date().setHours(0, 0, 0, 0))
    const [ventasHoy, ventasMes] = await Promise.all([
      supabaseAdmin
        .from("ventas")
        .select("id, total")
        .eq("organization_id", organizationId)
        .eq("vendedor_id", userId)
        .eq("estado", "COMPLETADA")
        .gte("created_at", hoyInicio.toISOString()),
      supabaseAdmin
        .from("ventas")
        .select("id, total")
        .eq("organization_id", organizationId)
        .eq("vendedor_id", userId)
        .eq("estado", "COMPLETADA")
        .gte("created_at", primerDiaMes.toISOString()),
    ])
    const ventasHoyData = ventasHoy.data as { total: number }[] | null
    misVentasHoyTotal = ventasHoyData?.reduce((sum, v) => sum + (v.total || 0), 0) || 0
    misVentasHoyCount = ventasHoyData?.length || 0
    const ventasMesData = ventasMes.data as { total: number }[] | null
    misVentasMesTotal = ventasMesData?.reduce((sum, v) => sum + (v.total || 0), 0) || 0
    misVentasMesCount = ventasMesData?.length || 0
  }

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
    ventasHoyResult,
    ventasMesResult,
    garantiasVentaPorVencerResult,
    ordenesPorTecnicoResult,
    ordenesPendienteCobroResult,
    ordenesFechaVencidaResult,
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
    const nombre = orden.users?.nombre || "Sin nombre"
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

  // Procesar deuda pendiente con antigüedad
  const ordenesPendienteCobro = (ordenesPendienteCobroResult?.data || []).map((o: any) => {
    const pendiente = (parseFloat(o.costo_final || 0)) - (parseFloat(o.descuento_cobro || 0)) - (parseFloat(o.total_cobrado || 0))
    const diasDesdeIngreso = Math.floor((Date.now() - new Date(o.fecha_ingreso).getTime()) / (1000 * 60 * 60 * 24))
    return {
      id: o.id,
      numeroOrden: o.numero_orden,
      codigoOrden: o.codigo_orden,
      cliente: o.clientes?.nombre || "Sin cliente",
      pendiente,
      dias: diasDesdeIngreso,
      estado: o.estado,
    }
  }).filter((o: any) => o.pendiente > 0)

  const totalDeudaPendiente = ordenesPendienteCobro.reduce((sum: number, o: any) => sum + o.pendiente, 0)
  const deuda30dias = ordenesPendienteCobro.filter((o: any) => o.dias <= 30)
  const deuda60dias = ordenesPendienteCobro.filter((o: any) => o.dias > 30 && o.dias <= 60)
  const deuda90dias = ordenesPendienteCobro.filter((o: any) => o.dias > 60)

  // SLA: Órdenes con fecha prometida vencida
  const ordenesFechaVencida = (ordenesFechaVencidaResult?.data || []).map((o: any) => ({
    id: o.id,
    numeroOrden: o.numero_orden,
    codigoOrden: o.codigo_orden,
    dispositivo: o.dispositivo,
    estado: o.estado,
    fechaPrometida: o.fecha_prometida,
    cliente: o.clientes?.nombre || "Sin cliente",
    diasAtraso: Math.floor((Date.now() - new Date(o.fecha_prometida).getTime()) / (1000 * 60 * 60 * 24)),
  }))

  // Procesar ventas
  const ventasHoyData = ventasHoyResult.data as { total: number }[] | null
  const ventasHoyTotal = ventasHoyData?.reduce((sum, v) => sum + (v.total || 0), 0) || 0
  const ventasHoyCount = ventasHoyData?.length || 0
  const ventasMesData = ventasMesResult.data as { total: number }[] | null
  const ventasMesTotal = ventasMesData?.reduce((sum, v) => sum + (v.total || 0), 0) || 0
  const ventasMesCount = ventasMesData?.length || 0
  const garantiasVentaPorVencer = garantiasVentaPorVencerResult.data || []

  // Stats filtrados por rol
  const adminStats = [
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
      value: formatCurrency(ingresos, moneda),
      description: "Facturas pagadas",
      icon: DollarSign,
      colorClass: "text-purple-600 dark:text-purple-400",
      bgClass: "bg-purple-50 dark:bg-purple-900/30",
    },
    {
      title: "Ventas Hoy",
      value: formatCurrency(ventasHoyTotal, moneda),
      description: `${ventasHoyCount} venta${ventasHoyCount !== 1 ? "s" : ""}`,
      icon: ShoppingCart,
      colorClass: "text-emerald-600 dark:text-emerald-400",
      bgClass: "bg-emerald-50 dark:bg-emerald-900/30",
    },
    {
      title: "Ventas del Mes",
      value: formatCurrency(ventasMesTotal, moneda),
      description: `${ventasMesCount} ventas completadas`,
      icon: TrendingUp,
      colorClass: "text-cyan-600 dark:text-cyan-400",
      bgClass: "bg-cyan-50 dark:bg-cyan-900/30",
    },
  ]

  const vendedorStats = [
    {
      title: "Órdenes Pendientes",
      value: ordenesPendientes.toString(),
      description: `${totalOrdenes} totales`,
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
      title: "Mis Ventas Hoy",
      value: formatCurrency(misVentasHoyTotal, moneda),
      description: `${misVentasHoyCount} venta${misVentasHoyCount !== 1 ? "s" : ""}`,
      icon: ShoppingCart,
      colorClass: "text-emerald-600 dark:text-emerald-400",
      bgClass: "bg-emerald-50 dark:bg-emerald-900/30",
    },
    {
      title: "Mis Ventas del Mes",
      value: formatCurrency(misVentasMesTotal, moneda),
      description: `${misVentasMesCount} ventas completadas`,
      icon: TrendingUp,
      colorClass: "text-cyan-600 dark:text-cyan-400",
      bgClass: "bg-cyan-50 dark:bg-cyan-900/30",
    },
  ]

  const tecnicoStats = [
    {
      title: "Mis Órdenes Activas",
      value: misOrdenesActivas.toString(),
      description: "Asignadas a mí",
      icon: ClipboardList,
      colorClass: "text-info-600 dark:text-info-500",
      bgClass: "bg-info-50 dark:bg-info-100/50",
    },
    {
      title: "Completadas (Mes)",
      value: misOrdenesCompletadas.toString(),
      description: "Reparadas/entregadas",
      icon: ClipboardList,
      colorClass: "text-success-600 dark:text-success-500",
      bgClass: "bg-success-50 dark:bg-success-100/50",
    },
  ]

  const stats = isTecnico ? tecnicoStats : isVendedor ? vendedorStats : adminStats

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-headline">Dashboard</h1>
        <p className="text-muted-foreground">
          Bienvenido, {session.user?.name || "Usuario"}
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-3">
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

      {/* Gráficos con lazy loading (Recharts) + Órdenes recientes - Solo Admin */}
      {isAdmin && (
        <DashboardCharts
          ordenesPorEstado={ordenesPorEstado}
          ingresosUltimos7Dias={ingresosUltimos7Dias}
          totalIngresos7Dias={totalIngresos7Dias}
          ordenesPorTecnico={ordenesPorTecnico}
        >
          <OrdenesRecientes ordenes={ordenesRecientes} />
        </DashboardCharts>
      )}

      {/* Vendedor: solo órdenes recientes */}
      {isVendedor && (
        <OrdenesRecientes ordenes={ordenesRecientes} />
      )}

      {/* Tercera fila: Alertas y Widget Dólar */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Alertas</CardTitle>
            <CardDescription>Notificaciones importantes</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isAdmin && garantiasPorVencer.length > 0 && (
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
            {(isAdmin || isVendedor) && garantiasVentaPorVencer.length > 0 && (
              <Link href="/ventas" className="block">
                <div className="p-3 bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-800 rounded-lg hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors">
                  <div className="flex items-center gap-2 text-purple-700 dark:text-purple-400 font-medium">
                    <ShoppingCart className="h-4 w-4" />
                    {garantiasVentaPorVencer.length} garantía{garantiasVentaPorVencer.length > 1 ? "s" : ""} de venta por vencer
                  </div>
                  <div className="mt-2 space-y-1">
                    {garantiasVentaPorVencer.slice(0, 3).map((g: any) => {
                      const diasRestantes = Math.ceil(
                        (new Date(g.fecha_vencimiento).getTime() - new Date().getTime()) /
                          (1000 * 60 * 60 * 24)
                      )
                      return (
                        <div key={g.id} className="text-sm text-purple-600 dark:text-purple-400">
                          V{String((g.ventas as any)?.numero_venta).padStart(4, "0")} - {(g.ventas as any)?.cliente_nombre} - {(g.items_venta as any)?.descripcion}
                          <span className="ml-1">({diasRestantes} día{diasRestantes !== 1 ? "s" : ""})</span>
                        </div>
                      )
                    })}
                    {garantiasVentaPorVencer.length > 3 && (
                      <p className="text-xs text-purple-500">
                        y {garantiasVentaPorVencer.length - 3} más...
                      </p>
                    )}
                  </div>
                </div>
              </Link>
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
            {/* SLA: Órdenes con fecha vencida - Solo Admin */}
            {isAdmin && ordenesFechaVencida.length > 0 && (
              <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg">
                <div className="flex items-center gap-2 text-red-700 dark:text-red-400 font-medium">
                  <ClipboardList className="h-4 w-4" />
                  {ordenesFechaVencida.length} orden{ordenesFechaVencida.length > 1 ? "es" : ""} con fecha prometida vencida
                </div>
                <div className="mt-2 space-y-1">
                  {ordenesFechaVencida.slice(0, 3).map((o: any) => (
                    <Link
                      key={o.id}
                      href={`/ordenes/${o.id}`}
                      className="block text-sm text-red-600 dark:text-red-400 hover:underline"
                    >
                      {o.codigoOrden || `#${o.numeroOrden}`} - {o.cliente}
                      <span className="ml-1">({o.diasAtraso} día{o.diasAtraso !== 1 ? "s" : ""} de atraso)</span>
                    </Link>
                  ))}
                  {ordenesFechaVencida.length > 3 && (
                    <p className="text-xs text-red-500">y {ordenesFechaVencida.length - 3} más...</p>
                  )}
                </div>
              </div>
            )}
            {/* Deuda pendiente de cobro - Solo Admin */}
            {isAdmin && ordenesPendienteCobro.length > 0 && (
              <div className="p-3 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg">
                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-medium">
                  <DollarSign className="h-4 w-4" />
                  {ordenesPendienteCobro.length} orden{ordenesPendienteCobro.length > 1 ? "es" : ""} sin cobrar — {formatCurrency(totalDeudaPendiente, moneda)}
                </div>
                <div className="mt-2 space-y-1 text-xs text-amber-600 dark:text-amber-400">
                  {deuda30dias.length > 0 && <div>0-30 días: {deuda30dias.length} ({formatCurrency(deuda30dias.reduce((s: number, o: any) => s + o.pendiente, 0), moneda)})</div>}
                  {deuda60dias.length > 0 && <div>31-60 días: {deuda60dias.length} ({formatCurrency(deuda60dias.reduce((s: number, o: any) => s + o.pendiente, 0), moneda)})</div>}
                  {deuda90dias.length > 0 && <div className="font-semibold">+60 días: {deuda90dias.length} ({formatCurrency(deuda90dias.reduce((s: number, o: any) => s + o.pendiente, 0), moneda)})</div>}
                </div>
              </div>
            )}
            {ordenesPendientes === 0 && itemsBajoStock === 0 && (isTecnico || (garantiasPorVencer.length === 0 && garantiasVentaPorVencer.length === 0 && ordenesFechaVencida.length === 0 && ordenesPendienteCobro.length === 0)) && (
              <p className="text-sm text-muted-foreground">
                No hay alertas pendientes
              </p>
            )}
          </CardContent>
        </Card>
        <DolarWidget />
      </div>

      {/* Modal de novedades — se muestra si hay nueva versión */}
      <WhatsNewModal lastSeenVersion={lastSeenVersion} />

      {/* NPS Survey — se muestra cada 60 días */}
      <NpsSurvey />
    </div>
  )
}
