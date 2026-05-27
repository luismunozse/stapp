import { supabaseAdmin } from "@/lib/supabase"
import { Resend } from "resend"
import { renderTemplate, getPlantilla } from "@/lib/whatsapp/plantillas-catalog"

const TURNO_TIPO_TO_CATALOG_KEY: Record<string, string> = {
  confirmacion: "turno_confirmacion",
  recordatorio_24h: "turno_recordatorio_24h",
  recordatorio_1h: "turno_recordatorio_1h",
  reprogramado: "turno_reprogramado",
  cancelado: "turno_cancelado",
  tecnico_en_camino: "turno_tecnico_en_camino",
}

let _resend: Resend | null = null
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY)
  return _resend
}

export type TurnoNotifTipo =
  | "confirmacion"
  | "recordatorio_24h"
  | "recordatorio_1h"
  | "reprogramado"
  | "cancelado"
  | "tecnico_en_camino"

export type TurnoNotifCanal = "whatsapp" | "email"

interface TurnoCtx {
  organizationId: string
  organizationName: string
  zonaHoraria?: string
  turnoId: string
  inicio: string
  fin?: string | null
  tipo: string
  direccion?: string | null
  tecnicoNombre?: string | null
  destinatarioNombre: string
  destinatarioEmail?: string | null
  destinatarioTelefono?: string | null
  equipo?: string | null
}

function fmtFecha(iso: string, tz?: string): string {
  try {
    return new Intl.DateTimeFormat("es-AR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: tz || "America/Argentina/Buenos_Aires",
    }).format(new Date(iso))
  } catch {
    return new Date(iso).toLocaleString("es-AR")
  }
}

interface TemplateOut {
  subject: string
  whatsapp: string
  html: string
}

function buildTemplate(
  tipo: TurnoNotifTipo,
  ctx: TurnoCtx,
  plantillasOverride?: Record<string, string> | null,
): TemplateOut {
  const fechaTxt = fmtFecha(ctx.inicio, ctx.zonaHoraria)
  const finTxt = ctx.fin
    ? new Intl.DateTimeFormat("es-AR", {
        hour: "2-digit", minute: "2-digit",
        timeZone: ctx.zonaHoraria || "America/Argentina/Buenos_Aires",
      }).format(new Date(ctx.fin))
    : null
  const ventana = finTxt ? ` (hasta ${finTxt})` : ""
  const dirLine = ctx.direccion ? `📍 ${ctx.direccion}\n` : ""
  const tecLine = ctx.tecnicoNombre ? `👤 Técnico: ${ctx.tecnicoNombre}\n` : ""
  const equipoLine = ctx.equipo ? `🔧 Equipo: ${ctx.equipo}\n` : ""

  const baseHtml = (title: string, body: string) => `
    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #111;">${title}</h2>
      <p>Hola ${ctx.destinatarioNombre},</p>
      ${body}
      <hr style="margin: 24px 0; border: none; border-top: 1px solid #eee;" />
      <p style="color: #666; font-size: 12px;">${ctx.organizationName}</p>
    </div>
  `.trim()

  // Si la organización tiene plantilla custom para este tipo, usar el catálogo.
  const catalogKey = TURNO_TIPO_TO_CATALOG_KEY[tipo]
  const override = catalogKey ? plantillasOverride?.[catalogKey] : null
  const plantillaCatalogo = catalogKey ? getPlantilla(catalogKey) : null
  const waText = (override && override.trim()) || plantillaCatalogo?.defaultText
  let whatsappOverride: string | null = null
  if (waText) {
    whatsappOverride = renderTemplate(waText, {
      cliente: ctx.destinatarioNombre,
      empresa: ctx.organizationName,
      turno_fecha: fechaTxt,
      turno_ventana: ventana,
      turno_direccion: ctx.direccion || "",
      turno_tecnico: ctx.tecnicoNombre || "",
      turno_equipo: ctx.equipo || "",
      turno_servicio: ctx.tipo || "",
      turno_hora: finTxt || "",
    })
  }

  const buildDefault = (): TemplateOut => {
    switch (tipo) {
    case "confirmacion":
      return {
        subject: `Turno agendado — ${ctx.organizationName}`,
        whatsapp:
          `*${ctx.organizationName}*\n` +
          `Tu turno fue agendado ✅\n\n` +
          `📅 ${fechaTxt}${ventana}\n` +
          dirLine + tecLine + equipoLine +
          `\nCualquier cambio, avisanos. ¡Gracias!`,
        html: baseHtml("Turno agendado", `
          <p>Tu turno fue agendado con éxito.</p>
          <p><strong>Fecha:</strong> ${fechaTxt}${ventana}</p>
          ${ctx.direccion ? `<p><strong>Dirección:</strong> ${ctx.direccion}</p>` : ""}
          ${ctx.tecnicoNombre ? `<p><strong>Técnico:</strong> ${ctx.tecnicoNombre}</p>` : ""}
          ${ctx.equipo ? `<p><strong>Equipo:</strong> ${ctx.equipo}</p>` : ""}
        `),
      }
    case "recordatorio_24h":
      return {
        subject: `Recordatorio: tu turno es mañana`,
        whatsapp:
          `*${ctx.organizationName}*\n` +
          `Te recordamos tu turno de mañana ⏰\n\n` +
          `📅 ${fechaTxt}${ventana}\n` +
          dirLine + tecLine + equipoLine,
        html: baseHtml("Recordatorio de turno", `
          <p>Te recordamos que tenés un turno mañana.</p>
          <p><strong>Fecha:</strong> ${fechaTxt}${ventana}</p>
          ${ctx.direccion ? `<p><strong>Dirección:</strong> ${ctx.direccion}</p>` : ""}
        `),
      }
    case "recordatorio_1h":
      return {
        subject: `Tu turno es en 1 hora`,
        whatsapp:
          `*${ctx.organizationName}*\n` +
          `Tu turno es en aproximadamente 1 hora.\n\n` +
          `📅 ${fechaTxt}${ventana}\n` +
          dirLine + tecLine,
        html: baseHtml("Turno próximo", `
          <p>Tu turno es en aproximadamente 1 hora.</p>
          <p><strong>Fecha:</strong> ${fechaTxt}${ventana}</p>
        `),
      }
    case "tecnico_en_camino":
      return {
        subject: `El técnico está en camino`,
        whatsapp:
          `*${ctx.organizationName}*\n` +
          `🚗 ${ctx.tecnicoNombre || "Nuestro técnico"} está en camino para tu turno de ${fechaTxt}.`,
        html: baseHtml("Técnico en camino", `
          <p>${ctx.tecnicoNombre || "Nuestro técnico"} está en camino para tu turno de ${fechaTxt}.</p>
        `),
      }
    case "reprogramado":
      return {
        subject: `Turno reprogramado`,
        whatsapp:
          `*${ctx.organizationName}*\n` +
          `Reprogramamos tu turno 📅\n` +
          `Nueva fecha: ${fechaTxt}${ventana}\n` +
          dirLine,
        html: baseHtml("Turno reprogramado", `
          <p>Reprogramamos tu turno.</p>
          <p><strong>Nueva fecha:</strong> ${fechaTxt}${ventana}</p>
        `),
      }
    case "cancelado":
      return {
        subject: `Turno cancelado`,
        whatsapp:
          `*${ctx.organizationName}*\n` +
          `Tu turno del ${fechaTxt} fue cancelado.\n` +
          `Si querés reagendar, respondé este mensaje.`,
        html: baseHtml("Turno cancelado", `
          <p>Tu turno del ${fechaTxt} fue cancelado.</p>
        `),
      }
    }
  }

  const out = buildDefault()
  if (whatsappOverride && override) {
    return { ...out, whatsapp: whatsappOverride }
  }
  return out
}

async function logNotif(
  organizationId: string,
  turnoId: string,
  tipo: TurnoNotifTipo,
  canal: TurnoNotifCanal,
  destinatario: string,
  estado: "ENVIADO" | "FALLIDO",
  contenido: string,
  errorMsg?: string,
) {
  await supabaseAdmin.from("turno_notificaciones").insert({
    organization_id: organizationId,
    turno_id: turnoId,
    tipo,
    canal,
    destinatario,
    estado,
    contenido,
    error_message: errorMsg || null,
  })
}

export interface SendResult {
  whatsapp?: { sent: boolean; error?: string }
  email?: { sent: boolean; error?: string }
}

export async function sendTurnoNotification(
  ctx: TurnoCtx,
  tipo: TurnoNotifTipo,
  canales?: TurnoNotifCanal[],
): Promise<SendResult> {
  const result: SendResult = {}

  const usarEmail = !canales || canales.includes("email")
  const usarWhatsapp = !canales || canales.includes("whatsapp")

  const { data: orgConfig } = await supabaseAdmin
    .from("organizations")
    .select("notificaciones_email, notificaciones_whatsapp, plantillas_whatsapp")
    .eq("id", ctx.organizationId)
    .single()

  const tpl = buildTemplate(tipo, ctx, orgConfig?.plantillas_whatsapp ?? null)

  // Email
  if (usarEmail && orgConfig?.notificaciones_email !== false && ctx.destinatarioEmail) {
    try {
      const { data, error } = await getResend().emails.send({
        from: `${ctx.organizationName} <notificaciones@${process.env.RESEND_DOMAIN || "resend.dev"}>`,
        to: ctx.destinatarioEmail,
        subject: tpl.subject,
        html: tpl.html,
      })
      if (error) throw new Error(error.message)
      result.email = { sent: true }
      await logNotif(ctx.organizationId, ctx.turnoId, tipo, "email", ctx.destinatarioEmail, "ENVIADO", tpl.html)
    } catch (err: any) {
      result.email = { sent: false, error: err.message }
      await logNotif(ctx.organizationId, ctx.turnoId, tipo, "email", ctx.destinatarioEmail, "FALLIDO", tpl.html, err.message)
    }
  }

  // WhatsApp
  if (usarWhatsapp && orgConfig?.notificaciones_whatsapp !== false && ctx.destinatarioTelefono) {
    try {
      const { data: waConfig } = await supabaseAdmin
        .from("whatsapp_config")
        .select("provider, is_configured, is_verified, evolution_connection_state")
        .eq("organization_id", ctx.organizationId)
        .single()

      const provider = (waConfig?.provider || "meta") as "meta" | "evolution"
      const canSendViaApi =
        waConfig?.is_configured &&
        (provider === "evolution"
          ? waConfig.evolution_connection_state === "open"
          : waConfig.is_verified)

      if (!canSendViaApi) {
        result.whatsapp = { sent: false, error: "WhatsApp no configurado" }
      } else {
        const { sendWhatsAppText } = await import("@/lib/whatsapp/providers")
        const wa = await sendWhatsAppText(
          ctx.organizationId,
          ctx.destinatarioTelefono,
          tpl.whatsapp,
        )
        if (wa.success) {
          result.whatsapp = { sent: true }
          await logNotif(ctx.organizationId, ctx.turnoId, tipo, "whatsapp", ctx.destinatarioTelefono, "ENVIADO", tpl.whatsapp)
        } else {
          result.whatsapp = { sent: false, error: wa.error }
          await logNotif(ctx.organizationId, ctx.turnoId, tipo, "whatsapp", ctx.destinatarioTelefono, "FALLIDO", tpl.whatsapp, wa.error)
        }
      }
    } catch (err: any) {
      result.whatsapp = { sent: false, error: err.message }
      await logNotif(ctx.organizationId, ctx.turnoId, tipo, "whatsapp", ctx.destinatarioTelefono, "FALLIDO", tpl.whatsapp, err.message)
    }
  }

  return result
}

/**
 * Carga el contexto del turno desde DB y dispara notificación.
 * Fire-and-forget desde rutas API.
 */
export async function notifyTurno(
  turnoId: string,
  tipo: TurnoNotifTipo,
  canales?: TurnoNotifCanal[],
): Promise<SendResult | null> {
  const { data: turno } = await supabaseAdmin
    .from("turnos")
    .select(`
      id, organization_id, inicio, fin, tipo, direccion,
      cliente_snapshot,
      clientes (id, nombre, email, telefono),
      users:tecnico_id (id, nombre),
      tipo_dispositivo, marca, modelo
    `)
    .eq("id", turnoId)
    .single()

  if (!turno) return null

  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("nombre, nombre_mostrar, zona_horaria")
    .eq("id", turno.organization_id)
    .single()

  if (!org) return null

  const cliente = (turno as any).clientes
  const snap = (turno as any).cliente_snapshot
  const tecnico = (turno as any).users

  const destinatarioNombre = cliente?.nombre || snap?.nombre || "Cliente"
  const destinatarioEmail = cliente?.email || snap?.email || null
  const destinatarioTelefono = cliente?.telefono || snap?.telefono || null

  const equipo = [turno.tipo_dispositivo, turno.marca, turno.modelo].filter(Boolean).join(" ")

  return sendTurnoNotification(
    {
      organizationId: turno.organization_id,
      organizationName: org.nombre_mostrar || org.nombre,
      zonaHoraria: org.zona_horaria || undefined,
      turnoId: turno.id,
      inicio: turno.inicio,
      fin: turno.fin,
      tipo: turno.tipo,
      direccion: turno.direccion,
      tecnicoNombre: tecnico?.nombre || null,
      destinatarioNombre,
      destinatarioEmail,
      destinatarioTelefono,
      equipo: equipo || null,
    },
    tipo,
    canales,
  )
}
