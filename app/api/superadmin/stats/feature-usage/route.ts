import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"

const FEATURE_LABELS: Record<string, string> = {
  usa_ordenes: "Ordenes de servicio",
  usa_cotizaciones: "Cotizaciones",
  usa_garantias: "Garantias",
  usa_fotos: "Fotos de ordenes",
  usa_ventas: "Ventas",
  usa_inventario: "Inventario",
  usa_whatsapp: "WhatsApp",
  usa_email_notif: "Email notificaciones",
  usa_facturacion: "Facturacion",
  usa_checklist: "Checklist recepcion",
  usa_firma_digital: "Firma digital",
  usa_tracking_publico: "Tracking publico",
}

export async function GET() {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    // Obtener el último snapshot de cada org
    const { data: latestUsage } = await supabaseAdmin
      .from("feature_usage")
      .select(`
        organization_id, fecha, adoption_score, features_activas, total_features,
        usa_ordenes, ordenes_count,
        usa_cotizaciones, cotizaciones_count,
        usa_garantias, garantias_count,
        usa_fotos, fotos_count,
        usa_ventas, ventas_count,
        usa_inventario, inventario_count,
        usa_whatsapp, whatsapp_count,
        usa_email_notif, email_count,
        usa_facturacion, facturas_count,
        usa_checklist, checklist_count,
        usa_firma_digital, firmas_count,
        usa_tracking_publico, tracking_count,
        usa_kiosco,
        tecnicos_count, vendedores_count, clientes_count,
        organizations (nombre, slug)
      `)
      .order("fecha", { ascending: false })

    // Deduplicate: solo el último registro por org
    type UsageRow = NonNullable<typeof latestUsage>[number]
    const orgMap = new Map<string, UsageRow>()
    for (const row of latestUsage || []) {
      if (!orgMap.has(row.organization_id)) {
        orgMap.set(row.organization_id, row)
      }
    }
    const latest = Array.from(orgMap.values())

    // Calcular adopción global por feature
    const featureKeys = Object.keys(FEATURE_LABELS) as (keyof typeof FEATURE_LABELS)[]
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
        fecha: r.fecha,
        features: featureKeys.reduce((acc, key) => {
          acc[key] = (r as Record<string, unknown>)[key] === true
          return acc
        }, {} as Record<string, boolean>),
      }
    }).sort((a, b) => a.adoptionScore - b.adoptionScore)

    // Summary
    const avgAdoption = latest.length > 0
      ? Math.round(latest.reduce((s, r) => s + r.adoption_score, 0) / latest.length)
      : 0
    const lowAdoption = latest.filter(r => r.adoption_score < 30).length
    const highAdoption = latest.filter(r => r.adoption_score >= 70).length

    return NextResponse.json({
      summary: {
        totalOrgs: latest.length,
        avgAdoption,
        lowAdoption,
        highAdoption,
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
