import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ClipboardList, Users, Package, DollarSign, Shield, ShoppingCart, TrendingUp, CheckCircle, AlertTriangle, Clock, Wrench } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import type { CurrencyCode } from "@/lib/currency"
import { redirect } from "next/navigation"
import Link from "next/link"
import { QuickActions } from "@/components/dashboard/quick-actions"
import { StatCard, type StatCardProps } from "@/components/dashboard/stat-card"
import { AlertItem } from "@/components/dashboard/alert-item"
import { OnboardingPanel } from "@/components/dashboard/onboarding-panel"
import { SetupChecklist } from "@/components/onboarding/setup-checklist"
import { DolarWidget } from "@/components/cotizacion-dolar"
import {
  OrdenesRecientes,
  DashboardCharts,
} from "@/components/dashboard"
import { WhatsNewModal } from "@/components/whats-new-modal"
import { NpsSurvey } from "@/components/nps-survey"
import { unstable_cache } from "next/cache"
import { HeroMetric } from "@/components/dashboard/hero-metric"
import { ActionStrip, buildAdminActions } from "@/components/dashboard/action-strip"

// Cachear datos del dashboard por 2 minutos
const getDashboardData = unstable_cache(
  async (organizationId: string) => {
    const hoy = new Date()
    const enSieteDias = new Date()
    enSieteDias.setDate(enSieteDias.getDate() + 7)
    const primerDiaMes = new Date(new Date().setDate(1))
    const hace7Dias = new Date()
    hace7Dias.setDate(hace7Dias.getDate() - 7)
    // Mes anterior (para comparativa)
    const primerDiaMesAnterior = new Date(primerDiaMes)
    primerDiaMesAnterior.setMonth(primerDiaMesAnterior.getMonth() - 1)
    const ultimoDiaMesAnterior = new Date(primerDiaMes.getTime() - 1)

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
      facturasHoyResult,
      cobrosOrdenHoyResult,
      ventasMesResult,
      ventasUltimos7DiasResult,
      garantiasVentaPorVencerResult,
      ordenesPorTecnicoResult,
      ordenesPendienteCobroResult,
      ordenesFechaVencidaResult,
      cobrosOrdenMesResult,
      cobrosOrdenUltimos7DiasResult,
      // Mes anterior
      ordenesMesAnteriorResult,
      ingresosMesAnteriorResult,
      ventasMesAnteriorResult,
      cobrosMesAnteriorResult,
      clientesMesAnteriorResult,
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
        .select("total, orden_id, ordenes_servicio!inner(organization_id)")
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
        .select("total, fecha, orden_id, ordenes_servicio!inner(organization_id)")
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
      // Facturas pagadas hoy
      supabaseAdmin
        .from("facturas")
        .select("total, orden_id, ordenes_servicio!inner(organization_id)")
        .eq("ordenes_servicio.organization_id", organizationId)
        .eq("estado_pago", "PAGADO")
        .gte("fecha", new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
      // Cobros directos a órdenes de hoy
      supabaseAdmin
        .from("cobros_orden")
        .select("monto, orden_id")
        .eq("organization_id", organizationId)
        .neq("anulado", true)
        .gte("created_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),

      // Ventas del mes
      supabaseAdmin
        .from("ventas")
        .select("id, total")
        .eq("organization_id", organizationId)
        .eq("estado", "COMPLETADA")
        .gte("created_at", primerDiaMes.toISOString()),

      // Ventas últimos 7 días (para gráfica de ingresos)
      supabaseAdmin
        .from("ventas")
        .select("total, created_at")
        .eq("organization_id", organizationId)
        .eq("estado", "COMPLETADA")
        .gte("created_at", hace7Dias.toISOString())
        .order("created_at", { ascending: true }),

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
        .in("estado", ["RECIBIDO", "EN_DIAGNOSTICO", "PRESUPUESTADO", "APROBADO", "EN_REPARACION", "ESPERANDO_REPUESTO", "REPARADO", "ENTREGADO", "ENTREGADO_SIN_REPARACION", "ENTREGADO_SIN_COBRO"]),
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
        .in("estado", ["REPARADO", "ENTREGADO", "ENTREGADO_SIN_REPARACION"])
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
      // Cobros directos a órdenes (sin factura) del mes actual
      supabaseAdmin
        .from("cobros_orden")
        .select("monto, orden_id")
        .eq("organization_id", organizationId)
        .neq("anulado", true)
        .gte("created_at", primerDiaMes.toISOString()),
      // Cobros directos a órdenes últimos 7 días (para gráfica)
      supabaseAdmin
        .from("cobros_orden")
        .select("monto, orden_id, created_at")
        .eq("organization_id", organizationId)
        .neq("anulado", true)
        .gte("created_at", hace7Dias.toISOString())
        .order("created_at", { ascending: true }),
      // --- Datos del mes anterior (para comparativa) ---
      // Órdenes pendientes mes anterior
      supabaseAdmin
        .from("ordenes_servicio")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .gte("fecha_ingreso", primerDiaMesAnterior.toISOString())
        .lte("fecha_ingreso", ultimoDiaMesAnterior.toISOString()),
      // Ingresos facturas mes anterior
      supabaseAdmin
        .from("facturas")
        .select("total, orden_id, ordenes_servicio!inner(organization_id)")
        .eq("ordenes_servicio.organization_id", organizationId)
        .eq("estado_pago", "PAGADO")
        .gte("fecha", primerDiaMesAnterior.toISOString())
        .lte("fecha", ultimoDiaMesAnterior.toISOString()),
      // Ventas mes anterior
      supabaseAdmin
        .from("ventas")
        .select("id, total")
        .eq("organization_id", organizationId)
        .eq("estado", "COMPLETADA")
        .gte("created_at", primerDiaMesAnterior.toISOString())
        .lte("created_at", ultimoDiaMesAnterior.toISOString()),
      // Cobros directos mes anterior
      supabaseAdmin
        .from("cobros_orden")
        .select("monto, orden_id")
        .eq("organization_id", organizationId)
        .neq("anulado", true)
        .gte("created_at", primerDiaMesAnterior.toISOString())
        .lte("created_at", ultimoDiaMesAnterior.toISOString()),
      // Clientes mes anterior
      supabaseAdmin
        .from("clientes")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .lte("created_at", ultimoDiaMesAnterior.toISOString()),
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
      facturasHoyResult,
      cobrosOrdenHoyResult,
      ventasMesResult,
      ventasUltimos7DiasResult,
      garantiasVentaPorVencerResult,
      ordenesPorTecnicoResult,
      ordenesPendienteCobroResult,
      ordenesFechaVencidaResult,
      cobrosOrdenMesResult,
      cobrosOrdenUltimos7DiasResult,
      ordenesMesAnteriorResult,
      ingresosMesAnteriorResult,
      ventasMesAnteriorResult,
      cobrosMesAnteriorResult,
      clientesMesAnteriorResult,
      hace7Dias: hace7Dias.toISOString(),
    }
  },
  ["dashboard-data", "by-org"],
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
  // También leemos `nombre` directo de la BD en vez de confiar en session.user.name,
  // porque el JWT cookie no siempre se refresca después de un cambio de nombre
  // (NextAuth v5 beta + auto-refresh path no actualiza name) y queremos que el
  // "Bienvenido, X" del dashboard refleje siempre el nombre actual.
  const { data: userData } = await supabaseAdmin
    .from("users")
    .select("last_seen_version, nombre")
    .eq("id", session.user.id)
    .single()
  const lastSeenVersion: string | null = userData?.last_seen_version ?? null
  const currentUserName: string = userData?.nombre || session.user?.name || "Usuario"

  // Obtener moneda de la organización y estado de onboarding
  const { data: orgData } = await supabaseAdmin
    .from("organizations")
    .select("moneda, zona_horaria, onboarding_completed, pais")
    .eq("id", organizationId)
    .single()
  const moneda = (orgData?.moneda || "ARS") as CurrencyCode
  const esArgentina = (orgData?.pais ?? "AR") === "AR"

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
  let misOrdenesRecientes: any[] = []

  let misSinDiagnostico = 0
  let misEsperandoRepuesto = 0
  let misVencidas: any[] = []
  let avgDiasResolucion: number | null = null

  if (isTecnico) {
    const primerDiaMes = new Date(new Date().setDate(1))
    const hoyIso = new Date().toISOString()
    const [activas, completadas, recientes, sinDiagnostico, esperandoRepuesto, vencidas, completadasConFecha] = await Promise.all([
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
        .in("estado", ["REPARADO", "ENTREGADO", "ENTREGADO_SIN_REPARACION", "ENTREGADO_SIN_COBRO"])
        .gte("fecha_ingreso", primerDiaMes.toISOString()),
      supabaseAdmin
        .from("ordenes_servicio")
        .select(`id, numero_orden, codigo_orden, dispositivo, estado, fecha_ingreso, fecha_prometida, clientes (nombre)`)
        .eq("organization_id", organizationId)
        .eq("tecnico_id", userId)
        .order("fecha_ingreso", { ascending: false })
        .limit(5),
      supabaseAdmin
        .from("ordenes_servicio")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("tecnico_id", userId)
        .eq("estado", "RECIBIDO"),
      supabaseAdmin
        .from("ordenes_servicio")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("tecnico_id", userId)
        .eq("estado", "ESPERANDO_REPUESTO"),
      supabaseAdmin
        .from("ordenes_servicio")
        .select(`id, numero_orden, codigo_orden, dispositivo, estado, fecha_prometida, clientes (nombre)`)
        .eq("organization_id", organizationId)
        .eq("tecnico_id", userId)
        .in("estado", ["RECIBIDO", "EN_DIAGNOSTICO", "PRESUPUESTADO", "APROBADO", "EN_REPARACION", "ESPERANDO_REPUESTO"])
        .lt("fecha_prometida", hoyIso)
        .not("fecha_prometida", "is", null)
        .order("fecha_prometida", { ascending: true }),
      supabaseAdmin
        .from("ordenes_servicio")
        .select("fecha_ingreso, fecha_completado")
        .eq("organization_id", organizationId)
        .eq("tecnico_id", userId)
        .in("estado", ["REPARADO", "ENTREGADO", "ENTREGADO_SIN_REPARACION", "ENTREGADO_SIN_COBRO"])
        .not("fecha_completado", "is", null)
        .gte("fecha_ingreso", primerDiaMes.toISOString()),
    ])
    misOrdenesActivas = activas.count || 0
    misOrdenesCompletadas = completadas.count || 0
    misSinDiagnostico = sinDiagnostico.count || 0
    misEsperandoRepuesto = esperandoRepuesto.count || 0
    misVencidas = (vencidas.data || []).map((o: any) => ({
      id: o.id,
      numeroOrden: o.numero_orden,
      codigoOrden: o.codigo_orden,
      dispositivo: o.dispositivo,
      estado: o.estado,
      fechaPrometida: o.fecha_prometida,
      cliente: o.clientes?.nombre || "Sin cliente",
      diasAtraso: Math.floor((Date.now() - new Date(o.fecha_prometida).getTime()) / (1000 * 60 * 60 * 24)),
    }))
    const completadasConFechaData = completadasConFecha.data || []
    if (completadasConFechaData.length > 0) {
      const totalDias = completadasConFechaData.reduce((sum: number, o: any) => {
        const dias = Math.floor((new Date(o.fecha_completado).getTime() - new Date(o.fecha_ingreso).getTime()) / (1000 * 60 * 60 * 24))
        return sum + dias
      }, 0)
      avgDiasResolucion = Math.round(totalDias / completadasConFechaData.length)
    }
    misOrdenesRecientes = (recientes.data || []).map((orden: any) => ({
      id: orden.id,
      numeroOrden: orden.numero_orden,
      codigoOrden: orden.codigo_orden,
      cliente: orden.clientes?.nombre || "Sin cliente",
      dispositivo: orden.dispositivo,
      estado: orden.estado,
      fechaIngreso: orden.fecha_ingreso,
    }))
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
    facturasHoyResult,
    cobrosOrdenHoyResult,
    ventasMesResult,
    ventasUltimos7DiasResult,
    garantiasVentaPorVencerResult,
    ordenesPorTecnicoResult,
    ordenesPendienteCobroResult,
    ordenesFechaVencidaResult,
    cobrosOrdenMesResult,
    cobrosOrdenUltimos7DiasResult,
    ordenesMesAnteriorResult,
    ingresosMesAnteriorResult,
    ventasMesAnteriorResult,
    cobrosMesAnteriorResult,
    clientesMesAnteriorResult,
    hace7Dias,
  } = await getDashboardData(organizationId)

  // Procesar datos básicos
  const totalOrdenes = totalOrdenesResult.count || 0
  const ordenesPendientes = ordenesPendientesResult.count || 0
  const totalClientes = totalClientesResult.count || 0
  const itemsBajoStock = itemsBajoStockResult.count || 0
  // Dedupe: si una orden ya tiene cobros directos en el período, no contar
  // su factura (representan el mismo servicio). cobros_orden es la fuente
  // de verdad porque refleja dinero efectivamente recibido.
  const cobrosOrdenMesData = (cobrosOrdenMesResult.data as { monto: number; orden_id: string }[] | null) || []
  const ordenesConCobroMes = new Set(cobrosOrdenMesData.map((c) => c.orden_id))
  const facturasData = ingresosMensualesResult.data as { total: number; orden_id: string }[] | null
  const ingresosFacturas = (facturasData || [])
    .filter((f) => !ordenesConCobroMes.has(f.orden_id))
    .reduce((sum, f) => sum + Number(f.total || 0), 0)
  const ingresosVentasMes = (ventasMesResult.data as { total: number }[] | null)?.reduce((sum, v) => sum + Number(v.total || 0), 0) || 0
  const ingresosCobrosOrdenMes = cobrosOrdenMesData.reduce((sum, c) => sum + Number(c.monto || 0), 0)
  const ingresos = ingresosFacturas + ingresosVentasMes + ingresosCobrosOrdenMes
  const garantiasPorVencer = garantiasPorVencerResult.data || []

  // --- Comparativa mes anterior ---
  const ordenesMesAnterior = ordenesMesAnteriorResult.count || 0
  const clientesMesAnterior = clientesMesAnteriorResult.count || 0
  const ingresosMesAnteriorData = ingresosMesAnteriorResult.data as { total: number; orden_id: string }[] | null
  const cobrosMesAnteriorData = (cobrosMesAnteriorResult.data as { monto: number; orden_id: string }[] | null) || []
  const ordenesConCobroMesAnt = new Set(cobrosMesAnteriorData.map((c) => c.orden_id))
  const ingresosFacturasAnt = (ingresosMesAnteriorData || [])
    .filter((f) => !ordenesConCobroMesAnt.has(f.orden_id))
    .reduce((sum, f) => sum + Number(f.total || 0), 0)
  const ingresosVentasAnt = (ventasMesAnteriorResult.data as { total: number }[] | null)?.reduce((sum, v) => sum + Number(v.total || 0), 0) || 0
  const ingresosCobrosAnt = cobrosMesAnteriorData.reduce((sum, c) => sum + Number(c.monto || 0), 0)
  const ingresosMesAnterior = ingresosFacturasAnt + ingresosVentasAnt + ingresosCobrosAnt

  // Helper para calcular variación porcentual
  function pctChange(current: number, previous: number): { pct: number; direction: "up" | "down" | "neutral" } | null {
    if (previous === 0 && current === 0) return null
    if (previous === 0) return { pct: 100, direction: "up" }
    const pct = Math.round(((current - previous) / previous) * 100)
    return { pct: Math.abs(pct), direction: pct > 0 ? "up" : pct < 0 ? "down" : "neutral" }
  }

  const ingresosChange = pctChange(ingresos, ingresosMesAnterior)
  const clientesChange = pctChange(totalClientes, clientesMesAnterior)

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
    ENTREGADO_SIN_REPARACION: 0,
    ENTREGADO_SIN_COBRO: 0,
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
  // Dedupe igual que arriba: ordenes con cobro directo en los últimos 7 días
  const cobros7d = (cobrosOrdenUltimos7DiasResult.data as { monto: number; orden_id: string; created_at: string }[] | null) || []
  const ordenesConCobro7d = new Set(cobros7d.map((c) => c.orden_id))
  // Sumar los ingresos de facturas (excluyendo las que ya tienen cobro directo)
  ingresosUltimos7DiasResult.data?.forEach((factura: { total: number; fecha: string; orden_id: string }) => {
    if (ordenesConCobro7d.has(factura.orden_id)) return
    const key = new Date(factura.fecha).toISOString().split("T")[0]
    if (key in ingresosMap) {
      ingresosMap[key] += Number(factura.total || 0)
    }
  })
  // Sumar los ingresos de ventas
  ventasUltimos7DiasResult.data?.forEach((venta: { total: number; created_at: string }) => {
    const key = new Date(venta.created_at).toISOString().split("T")[0]
    if (key in ingresosMap) {
      ingresosMap[key] += Number(venta.total || 0)
    }
  })
  // Sumar los cobros directos a órdenes (sin factura)
  cobros7d.forEach((cobro) => {
    const key = new Date(cobro.created_at).toISOString().split("T")[0]
    if (key in ingresosMap) {
      ingresosMap[key] += Number(cobro.monto || 0)
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
    if (["REPARADO", "ENTREGADO", "ENTREGADO_SIN_REPARACION", "ENTREGADO_SIN_COBRO"].includes(orden.estado)) {
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

  // Procesar ingresos de hoy (ventas + facturas + cobros de órdenes)
  const ventasHoyData = ventasHoyResult.data as { total: number }[] | null
  const ventasHoyTotal = ventasHoyData?.reduce((sum, v) => sum + (v.total || 0), 0) || 0
  const cobrosOrdenHoyData = (cobrosOrdenHoyResult.data as { monto: number; orden_id: string }[] | null) || []
  const ordenesConCobroHoy = new Set(cobrosOrdenHoyData.map((c) => c.orden_id))
  const facturasHoyData = facturasHoyResult.data as { total: number; orden_id: string }[] | null
  const ingresosFacturasHoy = (facturasHoyData || [])
    .filter((f) => !ordenesConCobroHoy.has(f.orden_id))
    .reduce((sum, f) => sum + Number(f.total || 0), 0)
  const ingresosCobrosOrdenHoy = cobrosOrdenHoyData.reduce((sum, c) => sum + Number(c.monto || 0), 0)
  const ingresosHoyTotal = ventasHoyTotal + ingresosFacturasHoy + ingresosCobrosOrdenHoy
  const ventasMesData = ventasMesResult.data as { total: number }[] | null
  const ventasMesTotal = ventasMesData?.reduce((sum, v) => sum + (v.total || 0), 0) || 0
  const ventasMesCount = ventasMesData?.length || 0
  const garantiasVentaPorVencer = garantiasVentaPorVencerResult.data || []

  // Stats filtrados por rol. `tone` usa el sistema semántico (info/success/
  // warning/danger) en vez del arcoíris de colores hardcodeados anterior.
  // Admin: only secondary KPIs — hero income + action concerns render separately.
  const adminStats: StatCardProps[] = [
    {
      title: "Órdenes Pendientes",
      value: ordenesPendientes.toString(),
      description: `${totalOrdenes} totales`,
      icon: ClipboardList,
      tone: "info",
      href: "/ordenes",
      compact: true,
    },
    {
      title: "Clientes",
      value: totalClientes.toString(),
      description: "Total registrados",
      icon: Users,
      tone: "success",
      href: "/clientes",
      change: clientesChange,
      compact: true,
    },
  ]

  const vendedorStats: StatCardProps[] = [
    {
      title: "Órdenes Pendientes",
      value: ordenesPendientes.toString(),
      description: `${totalOrdenes} totales`,
      icon: ClipboardList,
      tone: "info",
      href: "/ordenes",
    },
    {
      title: "Clientes",
      value: totalClientes.toString(),
      description: "Total registrados",
      icon: Users,
      tone: "success",
      href: "/clientes",
    },
    {
      title: "Mis Ventas Hoy",
      value: formatCurrency(misVentasHoyTotal, moneda),
      description: `${misVentasHoyCount} venta${misVentasHoyCount !== 1 ? "s" : ""}`,
      icon: ShoppingCart,
      tone: "success",
      href: "/ventas",
    },
    {
      title: "Mis Ventas del Mes",
      value: formatCurrency(misVentasMesTotal, moneda),
      description: `${misVentasMesCount} ventas completadas`,
      icon: TrendingUp,
      tone: "default",
      href: "/ventas",
    },
  ]

  const tecnicoStats: StatCardProps[] = [
    {
      title: "Mis Órdenes Activas",
      value: misOrdenesActivas.toString(),
      description: "Asignadas a mí",
      icon: ClipboardList,
      tone: "info",
      href: "/ordenes",
    },
    {
      title: "Sin Diagnóstico",
      value: misSinDiagnostico.toString(),
      description: "Requieren atención",
      icon: AlertTriangle,
      tone: misSinDiagnostico > 0 ? "warning" : "success",
      urgent: misSinDiagnostico > 0,
      href: "/ordenes?estado=RECIBIDO",
    },
    {
      title: "Esperando Repuesto",
      value: misEsperandoRepuesto.toString(),
      description: "En espera de piezas",
      icon: Clock,
      tone: misEsperandoRepuesto > 0 ? "warning" : "success",
      href: "/ordenes?estado=ESPERANDO_REPUESTO",
    },
    {
      title: "Completadas (Mes)",
      value: misOrdenesCompletadas.toString(),
      description: avgDiasResolucion !== null ? `Prom. ${avgDiasResolucion} día${avgDiasResolucion !== 1 ? "s" : ""}` : "Reparadas/entregadas",
      icon: CheckCircle,
      tone: "success",
      href: "/ordenes",
    },
  ]

  const stats = isTecnico ? tecnicoStats : isVendedor ? vendedorStats : adminStats

  const adminActions = isAdmin
    ? buildAdminActions({
        moneda,
        cobrosCount: ordenesPendienteCobro.length,
        deudaTotal: totalDeudaPendiente,
        slaVencidasCount: ordenesFechaVencida.length,
        garantiasCount: garantiasPorVencer.length + garantiasVentaPorVencer.length,
        stockBajoCount: itemsBajoStock,
      })
    : []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-headline">Dashboard</h1>
          <p className="text-muted-foreground">
            Bienvenido, {currentUserName}
          </p>
        </div>
        {isAdmin && esArgentina && <DolarWidget variant="header" />}
      </div>

      {/* Setup checklist (oculto al 100%) — guía nuevos/inactivos a su primera orden */}
      {isAdmin && <SetupChecklist />}

      {/* Onboarding para cuentas nuevas */}
      {isAdmin && totalOrdenes === 0 && (
        <OnboardingPanel
          hasConfig={!!orgData?.zona_horaria}
          hasTecnicos={ordenesPorTecnico.length > 0}
          hasOrdenes={totalOrdenes > 0}
        />
      )}

      {/* Acciones Rápidas */}
      {isAdmin && (
        <QuickActions cobrosPendientesCount={ordenesPendienteCobro.length} />
      )}

      {/* Hero income metric + action strip — admin only */}
      {isAdmin && (
        <>
          <HeroMetric
            title="Ingresos del mes"
            value={formatCurrency(ingresos, moneda)}
            change={ingresosChange}
            secondaryLabel="Hoy"
            secondaryValue={formatCurrency(ingresosHoyTotal, moneda)}
            sparkline={ingresosUltimos7Dias.map((d) => d.total)}
          />
          <ActionStrip items={adminActions} />
        </>
      )}

      {/* Stats Cards */}
      <div className={`grid gap-3 sm:gap-4 grid-cols-2 ${isTecnico ? "lg:grid-cols-4" : isVendedor ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}>
        {stats.map((stat) => (
          <StatCard key={stat.title} {...stat} />
        ))}
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

      {/* Vendedor y Técnico: solo órdenes recientes */}
      {isVendedor && (
        <OrdenesRecientes ordenes={ordenesRecientes} />
      )}
      {isTecnico && (
        <OrdenesRecientes ordenes={misOrdenesRecientes} />
      )}

      {/* Alertas y Widget Dólar — solo para vendedor/técnico (admin usa ActionStrip + header chip) */}
      {!isAdmin && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Alertas</CardTitle>
              <CardDescription>Notificaciones importantes</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {isAdmin && garantiasPorVencer.length > 0 && (
                <AlertItem
                  tone="warning"
                  icon={Shield}
                  title={`${garantiasPorVencer.length} garantía${garantiasPorVencer.length > 1 ? "s" : ""} por vencer`}
                >
                  {garantiasPorVencer.slice(0, 3).map((g: any) => {
                    const diasRestantes = Math.ceil(
                      (new Date(g.fecha_vencimiento).getTime() - new Date().getTime()) /
                        (1000 * 60 * 60 * 24)
                    )
                    return (
                      <Link
                        key={g.id}
                        href={`/ordenes/${g.orden_id}`}
                        className="block hover:underline"
                      >
                        Orden #{g.ordenes_servicio.numero_orden} - {g.ordenes_servicio.clientes?.nombre}
                        <span className="ml-1 opacity-80">
                          ({diasRestantes} día{diasRestantes !== 1 ? "s" : ""})
                        </span>
                      </Link>
                    )
                  })}
                  {garantiasPorVencer.length > 3 && (
                    <p className="text-xs opacity-80">
                      y {garantiasPorVencer.length - 3} más...
                    </p>
                  )}
                </AlertItem>
              )}
              {(isAdmin || isVendedor) && garantiasVentaPorVencer.length > 0 && (
                <AlertItem
                  tone="warning"
                  icon={ShoppingCart}
                  href="/ventas"
                  title={`${garantiasVentaPorVencer.length} garantía${garantiasVentaPorVencer.length > 1 ? "s" : ""} de venta por vencer`}
                >
                  {garantiasVentaPorVencer.slice(0, 3).map((g: any) => {
                    const diasRestantes = Math.ceil(
                      (new Date(g.fecha_vencimiento).getTime() - new Date().getTime()) /
                        (1000 * 60 * 60 * 24)
                    )
                    return (
                      <div key={g.id}>
                        V{String((g.ventas as any)?.numero_venta).padStart(4, "0")} - {(g.ventas as any)?.cliente_nombre} - {(g.items_venta as any)?.descripcion}
                        <span className="ml-1 opacity-80">({diasRestantes} día{diasRestantes !== 1 ? "s" : ""})</span>
                      </div>
                    )
                  })}
                  {garantiasVentaPorVencer.length > 3 && (
                    <p className="text-xs opacity-80">
                      y {garantiasVentaPorVencer.length - 3} más...
                    </p>
                  )}
                </AlertItem>
              )}
              {!isTecnico && itemsBajoStock > 0 && (
                <AlertItem
                  tone="warning"
                  icon={Package}
                  href="/inventario"
                  title={`${itemsBajoStock} items con stock bajo`}
                />
              )}
              {!isTecnico && ordenesPendientes > 0 && (
                <AlertItem
                  tone="info"
                  icon={ClipboardList}
                  href="/ordenes?estado=pendientes"
                  title={`${ordenesPendientes} órdenes pendientes`}
                />
              )}
              {/* SLA: Órdenes con fecha vencida - Solo Admin */}
              {isAdmin && ordenesFechaVencida.length > 0 && (
                <AlertItem
                  tone="danger"
                  icon={ClipboardList}
                  title={`${ordenesFechaVencida.length} orden${ordenesFechaVencida.length > 1 ? "es" : ""} con fecha prometida vencida`}
                >
                  {ordenesFechaVencida.slice(0, 3).map((o: any) => (
                    <Link
                      key={o.id}
                      href={`/ordenes/${o.id}`}
                      className="block hover:underline"
                    >
                      {o.codigoOrden || `#${o.numeroOrden}`} - {o.cliente}
                      <span className="ml-1 opacity-80">({o.diasAtraso} día{o.diasAtraso !== 1 ? "s" : ""} de atraso)</span>
                    </Link>
                  ))}
                  {ordenesFechaVencida.length > 3 && (
                    <p className="text-xs opacity-80">y {ordenesFechaVencida.length - 3} más...</p>
                  )}
                </AlertItem>
              )}
              {/* Deuda pendiente de cobro - Solo Admin */}
              {isAdmin && ordenesPendienteCobro.length > 0 && (
                <AlertItem
                  tone="warning"
                  icon={DollarSign}
                  title={`${ordenesPendienteCobro.length} orden${ordenesPendienteCobro.length > 1 ? "es" : ""} sin cobrar — ${formatCurrency(totalDeudaPendiente, moneda)}`}
                >
                  {deuda30dias.length > 0 && <div>0-30 días: {deuda30dias.length} ({formatCurrency(deuda30dias.reduce((s: number, o: any) => s + o.pendiente, 0), moneda)})</div>}
                  {deuda60dias.length > 0 && <div>31-60 días: {deuda60dias.length} ({formatCurrency(deuda60dias.reduce((s: number, o: any) => s + o.pendiente, 0), moneda)})</div>}
                  {deuda90dias.length > 0 && <div className="font-semibold">+60 días: {deuda90dias.length} ({formatCurrency(deuda90dias.reduce((s: number, o: any) => s + o.pendiente, 0), moneda)})</div>}
                </AlertItem>
              )}
              {/* Alertas específicas del técnico */}
              {isTecnico && misVencidas.length > 0 && (
                <AlertItem
                  tone="danger"
                  icon={AlertTriangle}
                  title={`${misVencidas.length} orden${misVencidas.length > 1 ? "es" : ""} con fecha prometida vencida`}
                >
                  {misVencidas.slice(0, 3).map((o: any) => (
                    <Link key={o.id} href={`/ordenes/${o.id}`} className="block hover:underline">
                      {o.codigoOrden || `#${o.numeroOrden}`} - {o.cliente}
                      <span className="ml-1 opacity-80">({o.diasAtraso} día{o.diasAtraso !== 1 ? "s" : ""} de atraso)</span>
                    </Link>
                  ))}
                  {misVencidas.length > 3 && (
                    <p className="text-xs opacity-80">y {misVencidas.length - 3} más...</p>
                  )}
                </AlertItem>
              )}
              {isTecnico && misEsperandoRepuesto > 0 && (
                <AlertItem
                  tone="info"
                  icon={Clock}
                  href="/ordenes?estado=ESPERANDO_REPUESTO"
                  title={`${misEsperandoRepuesto} orden${misEsperandoRepuesto > 1 ? "es" : ""} esperando repuesto`}
                />
              )}
              {isTecnico && misSinDiagnostico > 0 && (
                <AlertItem
                  tone="warning"
                  icon={Wrench}
                  href="/ordenes?estado=RECIBIDO"
                  title={`${misSinDiagnostico} orden${misSinDiagnostico > 1 ? "es" : ""} sin diagnóstico`}
                />
              )}
              {isTecnico && misVencidas.length === 0 && misEsperandoRepuesto === 0 && misSinDiagnostico === 0 && (
                <p className="text-sm text-muted-foreground">No hay alertas pendientes</p>
              )}
              {!isTecnico && ordenesPendientes === 0 && itemsBajoStock === 0 && garantiasPorVencer.length === 0 && garantiasVentaPorVencer.length === 0 && ordenesFechaVencida.length === 0 && ordenesPendienteCobro.length === 0 && (
                <p className="text-sm text-muted-foreground">No hay alertas pendientes</p>
              )}
            </CardContent>
          </Card>
          {esArgentina && <DolarWidget />}
        </div>
      )}

      {/* Modal de novedades — se muestra si hay nueva versión */}
      <WhatsNewModal lastSeenVersion={lastSeenVersion} />

      {/* NPS Survey — se muestra cada 60 días */}
      <NpsSurvey />
    </div>
  )
}
