import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

export const maxDuration = 60

/**
 * Cron de Feature Usage — analiza la adopción de funcionalidades por organización.
 *
 * NOTA: las queries usan count: "exact" con head: true para evitar el límite
 * de 1000 filas de Supabase PostgREST. Antes se traían todas las filas y se
 * contaban en JS, lo cual subreportaba cuando una tabla superaba las 1000 filas
 * totales entre todas las orgs.
 */

async function countRows(
  table: string,
  orgId: string,
  extraFilter?: { column: string; op: "eq" | "not_null"; value?: string }
): Promise<number> {
  let query = supabaseAdmin
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)

  if (extraFilter) {
    if (extraFilter.op === "eq" && extraFilter.value !== undefined) {
      query = query.eq(extraFilter.column, extraFilter.value)
    } else if (extraFilter.op === "not_null") {
      query = query.not(extraFilter.column, "is", null)
    }
  }

  const { count } = await query
  return count ?? 0
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  const expectedKey = process.env.CRON_SECRET
  if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  console.log("[feature-usage] Iniciando cron de feature usage")

  try {
    const fechaStr = new Date().toISOString().split("T")[0]

    const { data: orgs, error: orgsError } = await supabaseAdmin
      .from("organizations")
      .select("id, notificaciones_whatsapp, notificaciones_email, kiosco_habilitado")
      .eq("activo", true)

    if (orgsError) {
      console.error("[feature-usage] Error consultando orgs:", orgsError)
      return NextResponse.json({ error: "Error consultando organizaciones", detail: orgsError.message }, { status: 500 })
    }

    if (!orgs || orgs.length === 0) {
      console.log("[feature-usage] No se encontraron organizaciones activas")
      return NextResponse.json({ success: true, processed: 0 })
    }

    console.log(`[feature-usage] Procesando ${orgs.length} organizaciones activas`)

    let processed = 0
    let errors = 0

    for (const org of orgs) {
      try {
        const o = org.id

        // Contar por org con count queries (evita el límite de 1000 filas de PostgREST)
        const [
          ordenesCount, cotizacionesCount, garantiasCount, fotosCount,
          ventasCount, inventarioCount, whatsappCount, emailCount,
          facturasCount, checklistCount, firmasCount, trackingCount,
          tecnicosCount, vendedoresCount, clientesCount,
        ] = await Promise.all([
          countRows("ordenes_servicio", o),
          countRows("cotizaciones", o),
          countRows("garantias", o),
          countRows("fotos_orden", o),
          countRows("ventas", o),
          countRows("inventario", o),
          countRows("notification_logs", o, { column: "canal", op: "eq", value: "WHATSAPP" }),
          countRows("notification_logs", o, { column: "canal", op: "eq", value: "EMAIL" }),
          countRows("facturas", o),
          countRows("checklist_recepcion", o),
          countRows("cotizaciones", o, { column: "firma_cliente", op: "not_null" }),
          countRows("ordenes_servicio", o, { column: "public_token", op: "not_null" }),
          countRows("users", o, { column: "rol", op: "eq", value: "TECNICO" }),
          countRows("users", o, { column: "rol", op: "eq", value: "VENDEDOR" }),
          countRows("clientes", o),
        ])

        const features = [
          ordenesCount > 0, cotizacionesCount > 0,
          garantiasCount > 0, fotosCount > 0,
          ventasCount > 0, inventarioCount > 0,
          whatsappCount > 0 || !!org.notificaciones_whatsapp,
          emailCount > 0 || !!org.notificaciones_email,
          facturasCount > 0, checklistCount > 0,
          firmasCount > 0, trackingCount > 0,
        ]
        const featuresActivas = features.filter(Boolean).length
        const totalFeatures = features.length

        const { error: upsertError } = await supabaseAdmin.from("feature_usage").upsert({
          organization_id: o, fecha: fechaStr,
          usa_ordenes: features[0], ordenes_count: ordenesCount,
          usa_cotizaciones: features[1], cotizaciones_count: cotizacionesCount,
          usa_garantias: features[2], garantias_count: garantiasCount,
          usa_fotos: features[3], fotos_count: fotosCount,
          usa_ventas: features[4], ventas_count: ventasCount,
          usa_inventario: features[5], inventario_count: inventarioCount,
          usa_whatsapp: features[6], whatsapp_count: whatsappCount,
          usa_email_notif: features[7], email_count: emailCount,
          usa_facturacion: features[8], facturas_count: facturasCount,
          usa_checklist: features[9], checklist_count: checklistCount,
          usa_firma_digital: features[10], firmas_count: firmasCount,
          usa_tracking_publico: features[11], tracking_count: trackingCount,
          usa_kiosco: !!org.kiosco_habilitado,
          tecnicos_count: tecnicosCount,
          vendedores_count: vendedoresCount,
          clientes_count: clientesCount,
          adoption_score: Math.round((featuresActivas / totalFeatures) * 100),
          features_activas: featuresActivas, total_features: totalFeatures,
        }, { onConflict: "organization_id,fecha" })

        if (upsertError) {
          console.error(`[feature-usage] Error upsert org=${o}:`, upsertError)
          errors++
        } else {
          processed++
        }
      } catch (orgError) {
        console.error(`[feature-usage] Error procesando org=${org.id}:`, orgError)
        errors++
      }
    }

    console.log(
      `[feature-usage] Completado: ${processed}/${orgs.length} orgs procesadas, ` +
      `${errors} errores, fecha=${fechaStr}`
    )

    return NextResponse.json({
      success: true,
      processed,
      errors,
      total: orgs.length,
      fecha: fechaStr,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("[feature-usage] Error fatal en cron:", error)
    return NextResponse.json(
      { error: "Error calculando feature usage", detail: String(error) },
      { status: 500 }
    )
  }
}
