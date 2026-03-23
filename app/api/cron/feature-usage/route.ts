import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

export const maxDuration = 60

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  const expectedKey = process.env.CRON_SECRET
  if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  try {
    const fechaStr = new Date().toISOString().split("T")[0]

    const { data: orgs } = await supabaseAdmin
      .from("organizations")
      .select("id, notificaciones_whatsapp, notificaciones_email, kiosco_habilitado")
      .eq("activo", true)

    if (!orgs || orgs.length === 0) {
      return NextResponse.json({ success: true, processed: 0 })
    }

    const orgIds = orgs.map(o => o.id)

    // Bulk queries
    const [
      ordenesRes, cotizacionesRes, garantiasRes, fotosRes,
      ventasRes, inventarioRes, whatsappRes, emailRes,
      facturasRes, checklistRes, firmasRes, trackingRes,
      tecnicosRes, vendedoresRes, clientesRes,
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
    ])

    const countByOrg = (data: { organization_id: string }[] | null): Record<string, number> => {
      const c: Record<string, number> = {}
      for (const r of data || []) c[r.organization_id] = (c[r.organization_id] || 0) + 1
      return c
    }

    const counts = {
      ordenes: countByOrg(ordenesRes.data), cotizaciones: countByOrg(cotizacionesRes.data),
      garantias: countByOrg(garantiasRes.data), fotos: countByOrg(fotosRes.data),
      ventas: countByOrg(ventasRes.data), inventario: countByOrg(inventarioRes.data),
      whatsapp: countByOrg(whatsappRes.data), email: countByOrg(emailRes.data),
      facturas: countByOrg(facturasRes.data), checklist: countByOrg(checklistRes.data),
      firmas: countByOrg(firmasRes.data), tracking: countByOrg(trackingRes.data),
      tecnicos: countByOrg(tecnicosRes.data), vendedores: countByOrg(vendedoresRes.data),
      clientes: countByOrg(clientesRes.data),
    }

    let processed = 0
    for (const org of orgs) {
      const o = org.id
      const features = [
        (counts.ordenes[o] || 0) > 0, (counts.cotizaciones[o] || 0) > 0,
        (counts.garantias[o] || 0) > 0, (counts.fotos[o] || 0) > 0,
        (counts.ventas[o] || 0) > 0, (counts.inventario[o] || 0) > 0,
        (counts.whatsapp[o] || 0) > 0 || !!org.notificaciones_whatsapp,
        (counts.email[o] || 0) > 0 || !!org.notificaciones_email,
        (counts.facturas[o] || 0) > 0, (counts.checklist[o] || 0) > 0,
        (counts.firmas[o] || 0) > 0, (counts.tracking[o] || 0) > 0,
      ]
      const featuresActivas = features.filter(Boolean).length
      const totalFeatures = features.length

      await supabaseAdmin.from("feature_usage").upsert({
        organization_id: o, fecha: fechaStr,
        usa_ordenes: features[0], ordenes_count: counts.ordenes[o] || 0,
        usa_cotizaciones: features[1], cotizaciones_count: counts.cotizaciones[o] || 0,
        usa_garantias: features[2], garantias_count: counts.garantias[o] || 0,
        usa_fotos: features[3], fotos_count: counts.fotos[o] || 0,
        usa_ventas: features[4], ventas_count: counts.ventas[o] || 0,
        usa_inventario: features[5], inventario_count: counts.inventario[o] || 0,
        usa_whatsapp: features[6], whatsapp_count: counts.whatsapp[o] || 0,
        usa_email_notif: features[7], email_count: counts.email[o] || 0,
        usa_facturacion: features[8], facturas_count: counts.facturas[o] || 0,
        usa_checklist: features[9], checklist_count: counts.checklist[o] || 0,
        usa_firma_digital: features[10], firmas_count: counts.firmas[o] || 0,
        usa_tracking_publico: features[11], tracking_count: counts.tracking[o] || 0,
        usa_kiosco: !!org.kiosco_habilitado,
        tecnicos_count: counts.tecnicos[o] || 0,
        vendedores_count: counts.vendedores[o] || 0,
        clientes_count: counts.clientes[o] || 0,
        adoption_score: Math.round((featuresActivas / totalFeatures) * 100),
        features_activas: featuresActivas, total_features: totalFeatures,
      }, { onConflict: "organization_id,fecha" })

      processed++
    }

    return NextResponse.json({ success: true, processed, fecha: fechaStr, timestamp: new Date().toISOString() })
  } catch (error) {
    console.error("Error en cron feature-usage:", error)
    return NextResponse.json({ error: "Error calculando feature usage" }, { status: 500 })
  }
}
