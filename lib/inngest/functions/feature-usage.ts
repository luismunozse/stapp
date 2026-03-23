import { inngest } from "../client"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * Cron diario: Calcula el uso de features por organización
 * Se ejecuta todos los días a las 3:00 AM
 */
export const calculateFeatureUsage = inngest.createFunction(
  {
    id: "calculate-feature-usage",
    name: "Calculate Daily Feature Usage",
    retries: 1,
  },
  { cron: "0 3 * * *" },
  async ({ step }) => {
    const fechaStr = new Date().toISOString().split("T")[0]

    const orgsProcessed = await step.run("calculate-usage", async () => {
      const { data: orgs } = await supabaseAdmin
        .from("organizations")
        .select("id, notificaciones_whatsapp, notificaciones_email")
        .eq("activo", true)

      let processed = 0

      for (const org of orgs || []) {
        // Consultar todo en paralelo
        const [
          ordenesRes,
          cotizacionesRes,
          garantiasRes,
          fotosRes,
          ventasRes,
          inventarioRes,
          whatsappRes,
          emailRes,
          facturasRes,
          checklistRes,
          firmasRes,
          trackingRes,
          kioscoRes,
          tecnicosRes,
          vendedoresRes,
          clientesRes,
        ] = await Promise.all([
          supabaseAdmin.from("ordenes_servicio").select("id", { count: "exact", head: true }).eq("organization_id", org.id),
          supabaseAdmin.from("cotizaciones").select("id", { count: "exact", head: true }).eq("organization_id", org.id),
          supabaseAdmin.from("garantias").select("id", { count: "exact", head: true }).eq("organization_id", org.id),
          supabaseAdmin.from("fotos_orden").select("id", { count: "exact", head: true }).eq("organization_id", org.id),
          supabaseAdmin.from("ventas").select("id", { count: "exact", head: true }).eq("organization_id", org.id),
          supabaseAdmin.from("inventario").select("id", { count: "exact", head: true }).eq("organization_id", org.id),
          supabaseAdmin.from("notification_logs").select("id", { count: "exact", head: true }).eq("organization_id", org.id).eq("canal", "WHATSAPP"),
          supabaseAdmin.from("notification_logs").select("id", { count: "exact", head: true }).eq("organization_id", org.id).eq("canal", "EMAIL"),
          supabaseAdmin.from("facturas").select("id", { count: "exact", head: true }).eq("organization_id", org.id),
          supabaseAdmin.from("checklist_recepcion").select("id", { count: "exact", head: true }).eq("organization_id", org.id),
          // Firmas digitales: cotizaciones con firma
          supabaseAdmin.from("cotizaciones").select("id", { count: "exact", head: true }).eq("organization_id", org.id).not("firma_cliente", "is", null),
          // Tracking público: órdenes con publicToken
          supabaseAdmin.from("ordenes_servicio").select("id", { count: "exact", head: true }).eq("organization_id", org.id).not("public_token", "is", null),
          // Kiosco: check config
          supabaseAdmin.from("organizations").select("kiosco_habilitado").eq("id", org.id).single(),
          supabaseAdmin.from("users").select("id", { count: "exact", head: true }).eq("organization_id", org.id).eq("role", "TECNICO"),
          supabaseAdmin.from("users").select("id", { count: "exact", head: true }).eq("organization_id", org.id).eq("role", "VENDEDOR"),
          supabaseAdmin.from("clientes").select("id", { count: "exact", head: true }).eq("organization_id", org.id),
        ])

        const ordenes = ordenesRes.count || 0
        const cotizaciones = cotizacionesRes.count || 0
        const garantias = garantiasRes.count || 0
        const fotos = fotosRes.count || 0
        const ventas = ventasRes.count || 0
        const inventario = inventarioRes.count || 0
        const whatsapp = whatsappRes.count || 0
        const email = emailRes.count || 0
        const facturas = facturasRes.count || 0
        const checklist = checklistRes.count || 0
        const firmas = firmasRes.count || 0
        const tracking = trackingRes.count || 0
        const kioscoEnabled = kioscoRes.data?.kiosco_habilitado || false
        const tecnicos = tecnicosRes.count || 0
        const vendedores = vendedoresRes.count || 0
        const clientes = clientesRes.count || 0

        // Calcular features activas
        const features = [
          ordenes > 0,
          cotizaciones > 0,
          garantias > 0,
          fotos > 0,
          ventas > 0,
          inventario > 0,
          whatsapp > 0 || org.notificaciones_whatsapp,
          email > 0 || org.notificaciones_email,
          facturas > 0,
          checklist > 0,
          firmas > 0,
          tracking > 0,
        ]
        const featuresActivas = features.filter(Boolean).length
        const totalFeatures = features.length
        const adoptionScore = Math.round((featuresActivas / totalFeatures) * 100)

        await supabaseAdmin
          .from("feature_usage")
          .upsert({
            organization_id: org.id,
            fecha: fechaStr,
            usa_ordenes: ordenes > 0,
            ordenes_count: ordenes,
            usa_cotizaciones: cotizaciones > 0,
            cotizaciones_count: cotizaciones,
            usa_garantias: garantias > 0,
            garantias_count: garantias,
            usa_fotos: fotos > 0,
            fotos_count: fotos,
            usa_ventas: ventas > 0,
            ventas_count: ventas,
            usa_inventario: inventario > 0,
            inventario_count: inventario,
            usa_whatsapp: whatsapp > 0 || org.notificaciones_whatsapp,
            whatsapp_count: whatsapp,
            usa_email_notif: email > 0 || org.notificaciones_email,
            email_count: email,
            usa_facturacion: facturas > 0,
            facturas_count: facturas,
            usa_checklist: checklist > 0,
            checklist_count: checklist,
            usa_firma_digital: firmas > 0,
            firmas_count: firmas,
            usa_tracking_publico: tracking > 0,
            tracking_count: tracking,
            usa_kiosco: kioscoEnabled,
            tecnicos_count: tecnicos,
            vendedores_count: vendedores,
            clientes_count: clientes,
            adoption_score: adoptionScore,
            features_activas: featuresActivas,
            total_features: totalFeatures,
          }, {
            onConflict: "organization_id,fecha",
          })

        processed++
      }

      return processed
    })

    return { success: true, orgsProcessed, fecha: fechaStr }
  }
)
