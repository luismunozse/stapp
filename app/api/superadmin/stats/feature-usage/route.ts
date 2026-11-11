import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"

// Datos cambian 1x/día (cuando corre el cron de feature-usage). Cache 1h.
export const revalidate = 3600

const FEATURE_LABELS: Record<string, string> = {
  usa_ordenes: "Órdenes de servicio",
  usa_cotizaciones: "Cotizaciones",
  usa_garantias: "Garantías",
  usa_fotos: "Fotos de órdenes",
  usa_ventas: "Ventas",
  usa_inventario: "Inventario",
  usa_whatsapp: "WhatsApp",
  usa_email_notif: "Email notificaciones",
  usa_facturacion: "Facturación",
  usa_checklist: "Checklist recepción",
  usa_firma_digital: "Firma digital",
  usa_tracking_publico: "Tracking público",
  usa_kiosco: "Modo Kiosco",
}

// Mapa label → columna count correspondiente (para mostrar conteos por feature)
const FEATURE_COUNT_KEYS: Record<string, string | null> = {
  usa_ordenes: "ordenes_count",
  usa_cotizaciones: "cotizaciones_count",
  usa_garantias: "garantias_count",
  usa_fotos: "fotos_count",
  usa_ventas: "ventas_count",
  usa_inventario: "inventario_count",
  usa_whatsapp: "whatsapp_count",
  usa_email_notif: "email_count",
  usa_facturacion: "facturas_count",
  usa_checklist: "checklist_count",
  usa_firma_digital: "firmas_count",
  usa_tracking_publico: "tracking_count",
  usa_kiosco: null,
}

export async function GET() {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    // El último registro de cada org, resuelto en SQL (DISTINCT ON). Antes se
    // leía toda la tabla (una fila por org y por día) y PostgREST la cortaba en
    // 1000 filas sin error. Los datos los escribe el cron diario
    // /api/cron/feature-usage (con count/head por org); antes de su primera
    // corrida no hay nada que mostrar.
    const { data: ultimos, error: rpcError } = await supabaseAdmin.rpc("superadmin_feature_usage_ultimo")
    if (rpcError) throw rpcError

    type UsageRow = Record<string, unknown> & {
      organization_id: string
      fecha: string
      adoption_score: number
      features_activas: number
      total_features: number
      ordenes_count: number
      ventas_count: number
      clientes_count: number
      tecnicos_count: number
      organizations: { nombre: string; slug: string } | null
    }
    const latest = (Array.isArray(ultimos) ? ultimos : []) as UsageRow[]

    // Calcular adopción global por feature
    const featureKeys = Object.keys(FEATURE_LABELS)
    const featureAdoption = featureKeys.map(key => {
      const usingCount = latest.filter(r => (r as Record<string, unknown>)[key] === true).length
      return {
        feature: key,
        label: FEATURE_LABELS[key],
        usingCount,
        totalOrgs: latest.length,
        percentage: latest.length > 0 ? Math.round((usingCount / latest.length) * 100) : 0,
      }
    }).sort((a, b) => b.percentage - a.percentage)

    // Organizations con su adoption score
    const organizations = latest.map(r => {
      const org = r.organizations as unknown as { nombre: string; slug: string }
      const row = r as Record<string, unknown>
      return {
        id: r.organization_id,
        nombre: org?.nombre || "Unknown",
        slug: org?.slug || "",
        adoptionScore: r.adoption_score,
        featuresActivas: r.features_activas,
        totalFeatures: r.total_features,
        ordenes: r.ordenes_count,
        ventas: r.ventas_count,
        clientes: r.clientes_count,
        tecnicos: r.tecnicos_count,
        vendedores: (row.vendedores_count as number) || 0,
        fecha: r.fecha,
        features: featureKeys.reduce((acc, key) => {
          acc[key] = row[key] === true
          return acc
        }, {} as Record<string, boolean>),
        featureCounts: featureKeys.reduce((acc, key) => {
          const countKey = FEATURE_COUNT_KEYS[key]
          acc[key] = countKey ? ((row[countKey] as number) || 0) : 0
          return acc
        }, {} as Record<string, number>),
      }
    }).sort((a, b) => a.adoptionScore - b.adoptionScore)

    // Summary
    const avgAdoption = latest.length > 0
      ? Math.round(latest.reduce((s, r) => s + r.adoption_score, 0) / latest.length)
      : 0
    const lowAdoption = latest.filter(r => r.adoption_score < 30).length
    const midAdoption = latest.filter(r => r.adoption_score >= 30 && r.adoption_score < 70).length
    const highAdoption = latest.filter(r => r.adoption_score >= 70).length
    const zeroAdoption = latest.filter(r => r.adoption_score === 0).length

    // Última actualización del tracking (max fecha)
    const lastUpdate = latest.reduce<string | null>((acc, r) => {
      if (!acc || (r.fecha && r.fecha > acc)) return r.fecha
      return acc
    }, null)

    return NextResponse.json({
      summary: {
        totalOrgs: latest.length,
        avgAdoption,
        lowAdoption,
        midAdoption,
        highAdoption,
        zeroAdoption,
        lastUpdate,
      },
      featureAdoption,
      organizations,
      featureLabels: FEATURE_LABELS,
    })
  } catch (error) {
    console.error("Error fetching feature usage:", error)
    return NextResponse.json({ error: "Error al obtener feature usage" }, { status: 500 })
  }
}
