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
}

export async function GET() {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    // Primero intentar datos pre-calculados
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
    let latest = Array.from(orgMap.values())

    // Si no hay datos pre-calculados, calcular en tiempo real
    if (latest.length === 0) {
      const { data: orgs } = await supabaseAdmin
        .from("organizations")
        .select("id, nombre, slug, notificaciones_whatsapp, notificaciones_email")
        .eq("activo", true)

      if (!orgs || orgs.length === 0) {
        return NextResponse.json({
          summary: { totalOrgs: 0, avgAdoption: 0, lowAdoption: 0, highAdoption: 0 },
          featureAdoption: [],
          organizations: [],
          featureLabels: FEATURE_LABELS,
        })
      }

      // Traer todos los conteos en bulk (no por org)
      const orgIds = orgs.map(o => o.id)

      const [
        ordenesRes, cotizacionesRes, garantiasRes, fotosRes,
        ventasRes, inventarioRes, whatsappRes, emailRes,
        facturasRes, checklistRes, firmasRes, trackingRes,
        tecnicosRes, vendedoresRes, clientesRes, kioscoRes,
      ] = await Promise.all([
        supabaseAdmin.from("ordenes_servicio").select("organization_id").in("organization_id", orgIds),
        supabaseAdmin.from("cotizaciones").select("organization_id").in("organization_id", orgIds),
        supabaseAdmin.from("garantias").select("organization_id").in("organization_id", orgIds),
        supabaseAdmin.from("fotos_orden").select("organization_id").in("organization_id", orgIds),
        supabaseAdmin.from("ventas").select("organization_id").in("organization_id", orgIds),
        supabaseAdmin.from("inventario").select("organization_id").in("organization_id", orgIds),
        supabaseAdmin.from("notification_logs").select("organization_id").in("organization_id", orgIds).eq("canal", "WHATSAPP"),
        supabaseAdmin.from("notification_logs").select("organization_id").in("organization_id", orgIds).eq("canal", "EMAIL"),
        supabaseAdmin.from("facturas").select("organization_id").in("organization_id", orgIds),
        supabaseAdmin.from("checklist_recepcion").select("organization_id").in("organization_id", orgIds),
        supabaseAdmin.from("cotizaciones").select("organization_id").in("organization_id", orgIds).not("firma_cliente", "is", null),
        supabaseAdmin.from("ordenes_servicio").select("organization_id").in("organization_id", orgIds).not("public_token", "is", null),
        supabaseAdmin.from("users").select("organization_id").in("organization_id", orgIds).eq("rol", "TECNICO"),
        supabaseAdmin.from("users").select("organization_id").in("organization_id", orgIds).eq("rol", "VENDEDOR"),
        supabaseAdmin.from("clientes").select("organization_id").in("organization_id", orgIds),
        supabaseAdmin.from("kiosk_tokens").select("organization_id").in("organization_id", orgIds).eq("activo", true),
      ])

      // Contar por org usando Sets
      const countByOrg = (data: { organization_id: string }[] | null) => {
        const counts: Record<string, number> = {}
        for (const row of data || []) {
          counts[row.organization_id] = (counts[row.organization_id] || 0) + 1
        }
        return counts
      }

      const ordenesCounts = countByOrg(ordenesRes.data)
      const cotizacionesCounts = countByOrg(cotizacionesRes.data)
      const garantiasCounts = countByOrg(garantiasRes.data)
      const fotosCounts = countByOrg(fotosRes.data)
      const ventasCounts = countByOrg(ventasRes.data)
      const inventarioCounts = countByOrg(inventarioRes.data)
      const whatsappCounts = countByOrg(whatsappRes.data)
      const emailCounts = countByOrg(emailRes.data)
      const facturasCounts = countByOrg(facturasRes.data)
      const checklistCounts = countByOrg(checklistRes.data)
      const firmasCounts = countByOrg(firmasRes.data)
      const trackingCounts = countByOrg(trackingRes.data)
      const tecnicosCounts = countByOrg(tecnicosRes.data)
      const vendedoresCounts = countByOrg(vendedoresRes.data)
      const clientesCounts = countByOrg(clientesRes.data)
      const kioscoCounts = countByOrg(kioscoRes.data)

      const fechaHoy = new Date().toISOString().split("T")[0]

      latest = orgs.map(org => {
        const o = org.id
        const ordenes = ordenesCounts[o] || 0
        const cotizaciones = cotizacionesCounts[o] || 0
        const garantias = garantiasCounts[o] || 0
        const fotos = fotosCounts[o] || 0
        const ventas_ = ventasCounts[o] || 0
        const inventario = inventarioCounts[o] || 0
        const whatsapp = whatsappCounts[o] || 0
        const emailN = emailCounts[o] || 0
        const facturas = facturasCounts[o] || 0
        const checklist = checklistCounts[o] || 0
        const firmas = firmasCounts[o] || 0
        const tracking = trackingCounts[o] || 0

        const features = [
          ordenes > 0, cotizaciones > 0, garantias > 0, fotos > 0,
          ventas_ > 0, inventario > 0,
          whatsapp > 0 || !!org.notificaciones_whatsapp,
          emailN > 0 || !!org.notificaciones_email,
          facturas > 0, checklist > 0, firmas > 0, tracking > 0,
        ]
        const featuresActivas = features.filter(Boolean).length
        const totalFeatures = features.length
        const adoptionScore = Math.round((featuresActivas / totalFeatures) * 100)

        return {
          organization_id: o,
          fecha: fechaHoy,
          adoption_score: adoptionScore,
          features_activas: featuresActivas,
          total_features: totalFeatures,
          usa_ordenes: ordenes > 0,
          ordenes_count: ordenes,
          usa_cotizaciones: cotizaciones > 0,
          cotizaciones_count: cotizaciones,
          usa_garantias: garantias > 0,
          garantias_count: garantias,
          usa_fotos: fotos > 0,
          fotos_count: fotos,
          usa_ventas: ventas_ > 0,
          ventas_count: ventas_,
          usa_inventario: inventario > 0,
          inventario_count: inventario,
          usa_whatsapp: whatsapp > 0 || !!org.notificaciones_whatsapp,
          whatsapp_count: whatsapp,
          usa_email_notif: emailN > 0 || !!org.notificaciones_email,
          email_count: emailN,
          usa_facturacion: facturas > 0,
          facturas_count: facturas,
          usa_checklist: checklist > 0,
          checklist_count: checklist,
          usa_firma_digital: firmas > 0,
          firmas_count: firmas,
          usa_tracking_publico: tracking > 0,
          tracking_count: tracking,
          usa_kiosco: (kioscoCounts[o] || 0) > 0,
          tecnicos_count: tecnicosCounts[o] || 0,
          vendedores_count: vendedoresCounts[o] || 0,
          clientes_count: clientesCounts[o] || 0,
          organizations: { nombre: org.nombre, slug: org.slug },
        } as unknown as UsageRow
      })
    }

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
