import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { getLifecycleEmail, type LifecycleEmailType } from "@/lib/emails/lifecycle-templates"
import { esDestinatarioDeLaCampana } from "@/lib/billing/campana-preapproval"
import { enviarEmail, yaSeEnvio, registrarEnvio } from "@/lib/emails/enviar"

const EMAIL_TYPE: LifecycleEmailType = "PREAPPROVAL_INVITE"

/**
 * Invita a los talleres que pagan a mano a activar el debito automatico.
 *
 * Se dispara a mano y no por cron: es un envio unico, y cuando se manda lo
 * decide una persona.
 *
 * `simulacion` vale TRUE si no se dice lo contrario. Mandarle mails a clientes
 * reales no puede ser lo que pasa cuando alguien pega en el endpoint sin leer.
 */
export async function POST(request: Request) {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const body = await request.json().catch(() => ({}))
    const simulacion = body?.simulacion !== false

    // Sin .in(): se trae todo y se filtra el status en JS. El volumen de
    // suscripciones es chico (accion manual de superadmin, no un hot path).
    const { data: subs, error: dbError } = await supabaseAdmin
      .from("subscriptions")
      .select(`
        organization_id, status, mercadopago_preapproval_id,
        organizations!inner ( id, nombre, email, slug, activo ),
        plans!inner ( precio_mensual )
      `)

    if (dbError) {
      console.error("[campana-preapproval] Error consultando suscripciones:", dbError)
      return NextResponse.json({ error: "Error consultando suscripciones" }, { status: 500 })
    }

    const destinatarios: Array<{ organizationId: string; nombre: string; email: string; slug: string }> = []
    let sinEmail = 0

    const candidatas = ((subs || []) as any[]).filter(
      (sub) => sub.status === "ACTIVE" || sub.status === "PAST_DUE"
    )

    for (const sub of candidatas) {
      const org = sub.organizations
      if (!org || org.activo === false) continue

      const elegible = esDestinatarioDeLaCampana({
        precioMensual: Number(sub.plans?.precio_mensual) || 0,
        tienePreapproval: !!sub.mercadopago_preapproval_id,
        status: sub.status,
        yaRecibioElMail: await yaSeEnvio(sub.organization_id, EMAIL_TYPE),
      })

      if (!elegible) continue

      // Sin mail no hay a donde escribir. No es un fallo de envio: se cuenta aparte.
      if (!org.email) {
        sinEmail++
        continue
      }

      destinatarios.push({
        organizationId: sub.organization_id,
        nombre: org.nombre,
        email: org.email,
        slug: org.slug,
      })
    }

    if (simulacion) {
      return NextResponse.json({
        simulacion: true,
        destinatarios: destinatarios.map((d) => ({ nombre: d.nombre, email: d.email })),
        total: destinatarios.length,
        sinEmail,
        enviados: 0,
        fallidos: 0,
      })
    }

    let enviados = 0
    let fallidos = 0

    for (const d of destinatarios) {
      // No hay un contacto individual: la organizacion es a la vez el
      // destinatario y el "nombre" del saludo (no tenemos un admin separado
      // en esta consulta, a diferencia del cron de lifecycle emails).
      const { subject, html } = getLifecycleEmail(EMAIL_TYPE, {
        nombre: d.nombre,
        organizacion: d.nombre,
        slug: d.slug,
      })

      const ok = await enviarEmail(d.email, subject, html)
      await registrarEnvio(d.organizationId, EMAIL_TYPE, ok ? "SENT" : "FAILED")

      if (ok) enviados++
      else fallidos++
    }

    return NextResponse.json({
      simulacion: false,
      destinatarios: destinatarios.map((d) => ({ nombre: d.nombre, email: d.email })),
      total: destinatarios.length,
      sinEmail,
      enviados,
      fallidos,
    })
  } catch (err) {
    console.error("[campana-preapproval] Error:", err)
    return NextResponse.json({ error: "Error ejecutando la campaña" }, { status: 500 })
  }
}
