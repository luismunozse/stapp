import { NextRequest, NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"

const ENVIALOSIMPLE_API_URL = "https://backend.envialosimple.email/api/v1/mail/send"
const EMAIL_FROM = process.env.EMAIL_FROM || "noreply@stapp.com.ar"

// GET: Obtener segmentos disponibles y historial de campañas
export async function GET() {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const now = new Date()

    const in3Days = new Date(now)
    in3Days.setDate(in3Days.getDate() + 3)
    const in7Days = new Date(now)
    in7Days.setDate(in7Days.getDate() + 7)
    const sevenDaysAgo = new Date(now)
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const thirtyDaysAgo = new Date(now)
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    // Todo en paralelo - sin loops N+1
    const [
      allTrialingSubs,
      canceledRes,
      historialRes,
      allActiveOrgsRes,
      recentOrdenes7Res,
      recentOrdenes30Res,
    ] = await Promise.all([
      // Todos los trials (vencidos y activos) de orgs activas
      supabaseAdmin
        .from("subscriptions")
        .select(`
          organization_id,
          trial_end,
          organizations!inner (id, nombre, slug, activo)
        `)
        .eq("status", "TRIALING")
        .not("trial_end", "is", null)
        .eq("organizations.activo", true),

      // Cancelados
      supabaseAdmin
        .from("subscriptions")
        .select(`
          organization_id,
          organizations!inner (id, nombre, slug, activo)
        `)
        .eq("status", "CANCELED")
        .eq("organizations.activo", true),

      // Historial de campañas
      supabaseAdmin
        .from("lifecycle_emails")
        .select("email_type, status, sent_at, organization_id, metadata")
        .in("email_type", ["CAMPAIGN_CUSTOM", "CAMPAIGN_TRIAL_EXPIRED", "CAMPAIGN_TRIAL_EXPIRING", "CAMPAIGN_WIN_BACK", "CAMPAIGN_UPGRADE"])
        .order("sent_at", { ascending: false })
        .limit(50),

      // Todas las orgs activas
      supabaseAdmin
        .from("organizations")
        .select("id, nombre, slug")
        .eq("activo", true),

      // Orgs con órdenes en últimos 7 días (una sola query bulk)
      supabaseAdmin
        .from("ordenes_servicio")
        .select("organization_id")
        .gte("created_at", sevenDaysAgo.toISOString()),

      // Orgs con órdenes en últimos 30 días
      supabaseAdmin
        .from("ordenes_servicio")
        .select("organization_id")
        .gte("created_at", thirtyDaysAgo.toISOString()),
    ])

    // Clasificar trials por estado
    const allTrials = allTrialingSubs.data || []
    const trialExpiredData = allTrials.filter(s => new Date(s.trial_end!) <= now)
    const trialExpiring3Data = allTrials.filter(s => {
      const te = new Date(s.trial_end!)
      return te > now && te <= in3Days
    })
    const trialExpiring7Data = allTrials.filter(s => {
      const te = new Date(s.trial_end!)
      return te > now && te <= in7Days
    })
    const allTrialingActiveData = allTrials.filter(s => new Date(s.trial_end!) > now)

    // Calcular inactivos con sets (O(1) lookup, no loops)
    const activeIn7d = new Set((recentOrdenes7Res.data || []).map(o => o.organization_id))
    const activeIn30d = new Set((recentOrdenes30Res.data || []).map(o => o.organization_id))
    const allActiveOrgs = allActiveOrgsRes.data || []

    const inactivos7 = allActiveOrgs.filter(o => !activeIn7d.has(o.id))
    const inactivos30 = allActiveOrgs.filter(o => !activeIn30d.has(o.id))

    const formatOrgs = (data: any[] | null) =>
      (data || []).map((d: any) => {
        const org = d.organizations || d
        return {
          id: org.id || d.organization_id,
          nombre: org.nombre,
          slug: org.slug,
          trialEnd: d.trial_end || null,
        }
      })

    const segments = [
      {
        id: "trial_expired",
        nombre: "Trials vencidos",
        descripcion: "Organizaciones con trial expirado que no se suscribieron",
        count: trialExpiredData.length,
        orgs: formatOrgs(trialExpiredData),
        color: "red",
      },
      {
        id: "trial_expiring_3",
        nombre: "Trial vence en 3 dias",
        descripcion: "Organizaciones con trial por vencer en los proximos 3 dias",
        count: trialExpiring3Data.length,
        orgs: formatOrgs(trialExpiring3Data),
        color: "orange",
      },
      {
        id: "trial_expiring_7",
        nombre: "Trial vence en 7 dias",
        descripcion: "Organizaciones con trial por vencer en los proximos 7 dias",
        count: trialExpiring7Data.length,
        orgs: formatOrgs(trialExpiring7Data),
        color: "amber",
      },
      {
        id: "all_trialing",
        nombre: "Todos los trials activos",
        descripcion: "Todas las organizaciones en periodo de prueba",
        count: allTrialingActiveData.length,
        orgs: formatOrgs(allTrialingActiveData),
        color: "blue",
      },
      {
        id: "inactive_7",
        nombre: "Inactivos 7+ dias",
        descripcion: "Organizaciones sin ordenes en los ultimos 7 dias",
        count: inactivos7.length,
        orgs: inactivos7.map(o => ({ ...o, trialEnd: null })),
        color: "yellow",
      },
      {
        id: "inactive_30",
        nombre: "Inactivos 30+ dias",
        descripcion: "Organizaciones sin ordenes en los ultimos 30 dias",
        count: inactivos30.length,
        orgs: inactivos30.map(o => ({ ...o, trialEnd: null })),
        color: "red",
      },
      {
        id: "canceled",
        nombre: "Cancelados",
        descripcion: "Organizaciones que cancelaron su suscripcion",
        count: canceledRes.data?.length || 0,
        orgs: formatOrgs(canceledRes.data),
        color: "gray",
      },
    ]

    // Agrupar historial por campaña (mismo email_type + misma hora aprox)
    const campaigns: Array<{
      emailType: string
      sentAt: string
      totalSent: number
      totalFailed: number
      subject: string
    }> = []

    const historialData = historialRes.data || []
    const grouped = new Map<string, typeof historialData>()
    for (const h of historialData) {
      const key = `${h.email_type}_${h.sent_at?.slice(0, 16)}`
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key)!.push(h)
    }
    for (const [, items] of grouped) {
      campaigns.push({
        emailType: items[0].email_type,
        sentAt: items[0].sent_at,
        totalSent: items.filter((i: any) => i.status === "SENT").length,
        totalFailed: items.filter((i: any) => i.status === "FAILED").length,
        subject: (items[0].metadata as any)?.subject || items[0].email_type,
      })
    }

    return NextResponse.json({ segments, campaigns })
  } catch (error) {
    console.error("Error fetching email campaign data:", error)
    return NextResponse.json(
      { error: "Error al obtener datos de campañas" },
      { status: 500 }
    )
  }
}

// POST: Enviar campaña de email
export async function POST(request: NextRequest) {
  try {
    const { error: authError, email: superadminEmail } = await requireSuperadmin()
    if (authError) return authError

    const body = await request.json()
    const { segmentId, organizationIds, subject, htmlContent, emailType } = body

    if (!subject || !htmlContent) {
      return NextResponse.json(
        { error: "Asunto y contenido son requeridos" },
        { status: 400 }
      )
    }

    if (!organizationIds || organizationIds.length === 0) {
      return NextResponse.json(
        { error: "Debe seleccionar al menos una organizacion" },
        { status: 400 }
      )
    }

    const apiKey = process.env.ENVIALOSIMPLE_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: "ENVIALOSIMPLE_API_KEY no configurada" },
        { status: 500 }
      )
    }

    // Obtener admins de las organizaciones seleccionadas
    const { data: admins } = await supabaseAdmin
      .from("users")
      .select("id, nombre, email, organization_id")
      .in("organization_id", organizationIds)
      .eq("role", "ADMIN")

    if (!admins || admins.length === 0) {
      return NextResponse.json(
        { error: "No se encontraron administradores para las organizaciones seleccionadas" },
        { status: 400 }
      )
    }

    // Obtener nombres de orgs para personalización
    const { data: orgs } = await supabaseAdmin
      .from("organizations")
      .select("id, nombre, slug")
      .in("id", organizationIds)

    const orgMap = new Map((orgs || []).map(o => [o.id, o]))

    let sent = 0
    let failed = 0
    const campaignType = emailType || "CAMPAIGN_CUSTOM"

    for (const admin of admins) {
      if (!admin.email) continue

      const org = orgMap.get(admin.organization_id)
      // Personalizar contenido
      const personalizedHtml = htmlContent
        .replace(/\{\{nombre\}\}/g, admin.nombre || "")
        .replace(/\{\{organizacion\}\}/g, org?.nombre || "")
        .replace(/\{\{slug\}\}/g, org?.slug || "")

      try {
        const response = await fetch(ENVIALOSIMPLE_API_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: EMAIL_FROM,
            to: admin.email,
            subject,
            html: personalizedHtml,
          }),
        })

        const status = response.ok ? "SENT" : "FAILED"
        if (response.ok) sent++
        else failed++

        // Log cada envío
        await supabaseAdmin.from("lifecycle_emails").insert({
          organization_id: admin.organization_id,
          user_id: admin.id,
          email_type: campaignType,
          status,
          metadata: {
            subject,
            segmentId: segmentId || null,
            sentBy: superadminEmail,
          },
        })
      } catch {
        failed++
        await supabaseAdmin.from("lifecycle_emails").insert({
          organization_id: admin.organization_id,
          user_id: admin.id,
          email_type: campaignType,
          status: "FAILED",
          metadata: {
            subject,
            segmentId: segmentId || null,
            sentBy: superadminEmail,
          },
        })
      }
    }

    return NextResponse.json({
      success: true,
      message: `Campaña enviada: ${sent} exitosos, ${failed} fallidos`,
      sent,
      failed,
      total: admins.length,
    })
  } catch (error) {
    console.error("Error sending email campaign:", error)
    return NextResponse.json(
      { error: "Error al enviar campaña" },
      { status: 500 }
    )
  }
}
