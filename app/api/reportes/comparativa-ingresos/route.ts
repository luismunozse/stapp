import { NextResponse } from "next/server"
import { requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaLectura } from "@/lib/sucursal"
import { DEFAULT_TIMEZONE, getZonedParts, monthRangeUtc } from "@/lib/timezone"
import { nombreMesCivil } from "@/lib/finanzas-period"

/**
 * GET /api/reportes/comparativa-ingresos
 * Compara ingresos del mes actual vs mes anterior (cash basis).
 * Suma: ventas COMPLETADA + facturas PAGADO + cobros_orden no anulados.
 * Dedupe: si la orden tiene cobros directos en el período, no se cuenta su factura.
 * Branch filter: ventas direct, facturas via ordenes_servicio!inner, cobros via ordenes_servicio!inner.
 */
export async function GET() {
  try {
    const { error, organizationId, role, session } = await requireAdminOrVendedor()
    if (error) return error

    const filtro = await sucursalParaLectura({ role, userSucursalId: session!.user.sucursalId ?? null })

    const { data: orgTz } = await supabaseAdmin
      .from("organizations")
      .select("zona_horaria")
      .eq("id", organizationId!)
      .single()
    const tz = orgTz?.zona_horaria ?? DEFAULT_TIMEZONE

    const now = new Date()
    // Mes civil de `now` en la tz de la org — los límites Y los labels derivan de
    // acá. Antes los límites salían de now.getMonth() (UTC en Vercel), así que en
    // el tramo 21-24h del último día del mes las ventas caían en el mes siguiente
    // y quedaban desincronizadas del nombre del mes mostrado.
    const { year: anioCivil, month: mesCivil } = getZonedParts(now, tz)
    const inicioActual = monthRangeUtc(anioCivil, mesCivil, tz).desde
    const rangoAnterior = monthRangeUtc(anioCivil, mesCivil - 1, tz)
    const inicioAnterior = rangoAnterior.desde
    const finAnterior = rangoAnterior.hasta

    const sumarPeriodo = async (desde: Date, hasta?: Date) => {
      const desdeISO = desde.toISOString()
      const hastaISO = hasta?.toISOString()

      let ventasQuery = supabaseAdmin
        .from("ventas")
        .select("id, total, iva_neto, iva_monto")
        .eq("organization_id", organizationId!)
        .eq("estado", "COMPLETADA")
        .gte("created_at", desdeISO)
      if (!filtro.verTodas && filtro.sucursalId) {
        ventasQuery = ventasQuery.eq("sucursal_id", filtro.sucursalId)
      }
      if (hastaISO) ventasQuery = ventasQuery.lte("created_at", hastaISO)

      let facturasQuery = supabaseAdmin
        .from("facturas")
        .select("id, total, subtotal, iva, orden_id, ordenes_servicio!inner(organization_id, sucursal_id)")
        .eq("ordenes_servicio.organization_id", organizationId!)
        .eq("estado_pago", "PAGADO")
        .gte("fecha", desdeISO)
      if (!filtro.verTodas && filtro.sucursalId) {
        facturasQuery = facturasQuery.eq("ordenes_servicio.sucursal_id", filtro.sucursalId)
      }
      if (hastaISO) facturasQuery = facturasQuery.lte("fecha", hastaISO)

      let cobrosQuery = supabaseAdmin
        .from("cobros_orden")
        .select("id, monto, orden_id, ordenes_servicio!inner(organization_id, sucursal_id)")
        .eq("ordenes_servicio.organization_id", organizationId!)
        .neq("anulado", true)
        .gte("created_at", desdeISO)
      if (!filtro.verTodas && filtro.sucursalId) {
        cobrosQuery = cobrosQuery.eq("ordenes_servicio.sucursal_id", filtro.sucursalId)
      }
      if (hastaISO) cobrosQuery = cobrosQuery.lte("created_at", hastaISO)

      let notasCreditoQuery = supabaseAdmin
        .from("notas_credito")
        .select("monto")
        .eq("organization_id", organizationId!)
        .eq("anulada", false)
        .gte("fecha", desdeISO)
      if (!filtro.verTodas && filtro.sucursalId) {
        notasCreditoQuery = notasCreditoQuery.eq("sucursal_id", filtro.sucursalId)
      }
      if (hastaISO) notasCreditoQuery = notasCreditoQuery.lte("fecha", hastaISO)

      const [ventasR, facturasR, cobrosR, notasCreditoR] = await Promise.all([
        ventasQuery,
        facturasQuery,
        cobrosQuery,
        notasCreditoQuery,
      ])

      const ventas = (ventasR.data || []) as { id: string; total: number; iva_neto?: number | null; iva_monto?: number | null }[]
      const facturas = (facturasR.data || []) as { id: string; total: number; subtotal?: number; iva?: number | null; orden_id: string }[]
      const cobros = (cobrosR.data || []) as { id: string; monto: number; orden_id: string }[]
      const notasCredito = (notasCreditoR.data || []) as { monto: number }[]

      const ordenesConCobro = new Set(cobros.map((c) => c.orden_id))
      // NET: COALESCE(iva_neto, total) — iva_neto is NULL for EXENTO/legacy (no-op)
      const totalVentas = ventas.reduce((s, v) => s + Number(v.iva_neto ?? v.total ?? 0), 0)
      // NET: subtotal (== total when no IVA — EXENTO no-op)
      const totalFacturas = facturas
        .filter((f) => !ordenesConCobro.has(f.orden_id))
        .reduce((s, f) => s + Number(f.subtotal || f.total || 0), 0)
      // Direct order payments: no IVA breakdown — kept at gross (face value)
      const totalCobros = cobros.reduce((s, c) => s + Number(c.monto || 0), 0)
      const totalNotasCredito = notasCredito.reduce((s, n) => s + Number(n.monto || 0), 0)
      // IVA breakdown: ventas iva_monto + facturas iva; cobros_orden have no breakdown
      const totalIvaVentas = ventas.reduce((s, v) => s + Number(v.iva_monto || 0), 0)
      const totalIvaFacturas = facturas
        .filter((f) => !ordenesConCobro.has(f.orden_id))
        .reduce((s, f) => s + Number(f.iva || 0), 0)
      const totalIva = totalIvaVentas + totalIvaFacturas

      const total = totalVentas + totalFacturas + totalCobros - totalNotasCredito
      const cantidad = ventas.length + facturas.length + cobros.length

      return { total, cantidad, totalNotasCredito, totalIva }
    }

    const [actual, anterior] = await Promise.all([
      sumarPeriodo(inicioActual),
      sumarPeriodo(inicioAnterior, finAnterior),
    ])

    const promedioActual = actual.cantidad > 0 ? actual.total / actual.cantidad : 0
    const promedioAnterior = anterior.cantidad > 0 ? anterior.total / anterior.cantidad : 0

    let porcentajeCambio = 0
    let direccion: "up" | "down" | "neutral" = "neutral"
    if (anterior.total > 0) {
      porcentajeCambio = ((actual.total - anterior.total) / anterior.total) * 100
      direccion = porcentajeCambio > 0 ? "up" : porcentajeCambio < 0 ? "down" : "neutral"
    } else if (actual.total > 0) {
      porcentajeCambio = 100
      direccion = "up"
    }

    // anioCivil / mesCivil ya se resolvieron arriba desde la tz de la org, así
    // que los nombres de mes coinciden con los límites de las queries.
    return NextResponse.json({
      mesActual: {
        nombre: nombreMesCivil(anioCivil, mesCivil, tz).completo,
        // NET income (base imponible) after notas de crédito
        total: actual.total,
        totalIva: actual.totalIva,
        cantidad: actual.cantidad,
        promedio: promedioActual,
        totalNotasCredito: actual.totalNotasCredito,
      },
      mesAnterior: {
        nombre: nombreMesCivil(anioCivil, mesCivil - 1, tz).completo,
        // NET income (base imponible) after notas de crédito
        total: anterior.total,
        totalIva: anterior.totalIva,
        cantidad: anterior.cantidad,
        promedio: promedioAnterior,
        totalNotasCredito: anterior.totalNotasCredito,
      },
      cambio: {
        porcentaje: Math.round(porcentajeCambio * 10) / 10,
        direccion,
        diferencia: actual.total - anterior.total,
      },
    })
  } catch (error) {
    console.error("Error en comparativa de ingresos:", error)
    return NextResponse.json(
      { error: "Error al obtener comparativa de ingresos" },
      { status: 500 }
    )
  }
}
