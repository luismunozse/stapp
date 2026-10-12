import { NextResponse } from "next/server"
import { Webhook } from "svix"
import { supabaseAdmin } from "@/lib/supabase"
import { suprimirEmail } from "@/lib/email/suppression"

/**
 * Webhook de Resend: eventos de entrega del correo al cliente del taller.
 *
 * NO va bajo requireCronAuth. Este endpoint es publico por necesidad -lo llama
 * Resend- y su autenticacion ES la firma Svix. Sin verificarla, cualquiera que
 * descubra la URL podria dar de baja direcciones arbitrarias y dejar a los
 * talleres sin notificaciones, sin que ningun error se manifieste.
 */

type EventoResend = {
  type: string
  created_at: string
  data: {
    email_id: string
    to?: string[]
    subject?: string
    bounce?: { message?: string; subType?: string; type?: string }
  }
}

/**
 * El estado de entrega solo avanza. Los webhooks llegan desordenados: sin este
 * guard, un `delivered` retrasado pisaria una queja ya registrada, que es el
 * dato de mayor valor. El filtro va en el WHERE del UPDATE y no en una lectura
 * previa, para que sea atomico frente a eventos concurrentes.
 */
const ESTADOS_PREVIOS_PERMITIDOS: Record<string, string> = {
  ENTREGADO: "estado_entrega.is.null",
  REBOTADO: "estado_entrega.is.null,estado_entrega.eq.ENTREGADO",
  QUEJA: "estado_entrega.is.null,estado_entrega.eq.ENTREGADO,estado_entrega.eq.REBOTADO",
}

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    console.error("webhook resend: RESEND_WEBHOOK_SECRET no esta configurada")
    return NextResponse.json({ error: "webhook no configurado" }, { status: 500 })
  }

  // La firma se calcula sobre el cuerpo CRUDO. Llamar a request.json() primero
  // consume el stream y la verificacion falla siempre.
  const raw = await request.text()

  let evento: EventoResend
  try {
    // verify() valida y TIRA si la firma no coincide; no devuelve el payload
    // (llama al verificador interno con jsonParse:false, asi que su unica
    // funcion es la excepcion). El evento se parsea del cuerpo crudo, que es
    // el mismo string que se acaba de verificar.
    new Webhook(secret).verify(raw, {
      "svix-id": request.headers.get("svix-id") ?? "",
      "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
      "svix-signature": request.headers.get("svix-signature") ?? "",
    })
    evento = JSON.parse(raw) as EventoResend
  } catch (err) {
    console.error("webhook resend: firma invalida", err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "firma invalida" }, { status: 401 })
  }

  const ahora = new Date().toISOString()
  const emailId = evento.data?.email_id
  const destinatario = evento.data?.to?.[0] ?? null

  let patch: Record<string, unknown> | null = null
  let nuevoEstado: string | null = null
  let motivoSupresion: "HARD_BOUNCE" | "QUEJA" | null = null

  switch (evento.type) {
    case "email.delivered":
      nuevoEstado = "ENTREGADO"
      patch = { estado_entrega: "ENTREGADO", delivered_at: ahora }
      break

    case "email.bounced": {
      const esHard = evento.data?.bounce?.type === "Permanent"
      if (esHard) {
        nuevoEstado = "REBOTADO"
        patch = { estado_entrega: "REBOTADO", bounced_at: ahora, bounce_tipo: "HARD" }
        motivoSupresion = "HARD_BOUNCE"
      } else {
        // Soft bounce: se deja constancia pero NO se mueve estado_entrega,
        // porque tras un rebote blando la entrega suele concretarse.
        patch = { bounced_at: ahora, bounce_tipo: "SOFT" }
      }
      break
    }

    case "email.complained":
      nuevoEstado = "QUEJA"
      patch = { estado_entrega: "QUEJA", bounced_at: ahora, bounce_tipo: "QUEJA" }
      motivoSupresion = "QUEJA"
      break

    default:
      // No suscribimos opened ni clicked, pero si alguien los habilita en el
      // panel de Resend no queremos que el endpoint empiece a devolver error.
      return NextResponse.json({ ok: true, ignorado: evento.type })
  }

  let query = supabaseAdmin
    .from("notification_logs")
    .update(patch)
    .eq("provider_message_id", emailId)

  if (nuevoEstado) {
    query = query.or(ESTADOS_PREVIOS_PERMITIDOS[nuevoEstado])
  }

  const { data: filas, error } = await query.select("id, organization_id")

  if (error) {
    console.error("webhook resend: fallo el update", error.message)
    // 500 para que Resend reintente: el evento es valido, la falla es nuestra.
    return NextResponse.json({ error: "no se pudo registrar el evento" }, { status: 500 })
  }

  const fila = (filas as Array<{ id: string; organization_id: string }> | null)?.[0] ?? null

  if (!fila) {
    // Puede ser correo anterior a la 321 (sin provider_message_id), un aviso
    // que nunca escribio en notification_logs (ej. turnos, que registra en
    // turno_notificaciones), o un evento repetido que el guard de precedencia
    // ya descarto.
    console.warn("webhook resend: sin fila para email_id", emailId, evento.type)
  }

  // El bounce o la queja son autoritativos sobre el destinatario aunque no
  // podamos correlacionar el evento con una fila propia: no encontrar la fila
  // no es motivo para dejar de suprimir. organizationId/notificationLogId son
  // campos de auditoria, nullable justamente para este caso.
  if (motivoSupresion && destinatario) {
    await suprimirEmail({
      email: destinatario,
      motivo: motivoSupresion,
      proveedor: "resend",
      organizationId: fila?.organization_id ?? null,
      notificationLogId: fila?.id ?? null,
    })
  }

  if (!fila) {
    // 200, NO 500: devolver error haria que Resend reintente indefinidamente
    // sobre correo que nunca vamos a poder correlacionar.
    return NextResponse.json({ ok: true, correlacionado: false })
  }

  return NextResponse.json({ ok: true, correlacionado: true })
}
