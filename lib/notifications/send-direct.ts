import { supabaseAdmin } from "@/lib/supabase"
import { Resend } from "resend"
import { formatDateValue } from "@/lib/timezone"
import { renderTemplate } from "@/lib/whatsapp/plantillas-catalog"
import { formatCurrencyValue, type CurrencyCode, DEFAULT_CURRENCY } from "@/lib/currency"
import { sendPushToUsers } from "@/lib/push/send"
import { generateWhatsAppMessage, getBaseUrl, formatEstado } from "@/lib/notifications/whatsapp-message"

/**
 * Mapeo de NotificationType (legacy) a la key del catálogo de plantillas.
 * Si el override existe se renderiza con las variables del context.
 */
const TIPO_TO_CATALOG_KEY: Record<string, string> = {
  CAMBIO_ESTADO: "orden_estado_actual",
  PRESUPUESTO_DEFINIDO: "orden_presupuesto",
  GARANTIA_CREADA: "garantia_creada",
  RECORDATORIO_RETIRO: "orden_listo_retirar",
  BIENVENIDA_CLIENTE: "bienvenida_cliente",
  RESPUESTA_CONSULTA: "respuesta_consulta",
  RECORDATORIO_PAGO: "cobranza_recordatorio_pago",
  CONFIRMACION_PAGO: "cobranza_confirmacion_pago",
  LINK_PAGO: "cobranza_link_pago",
  MANTENIMIENTO_PREVENTIVO: "mantenimiento_preventivo",
  PROMOCION: "promocion",
  ENCUESTA_SATISFACCION: "encuesta_satisfaccion",
  FELICITACION: "felicitacion",
  SOLICITUD_INFO: "orden_solicitud_info",
  REPUESTO_DISPONIBLE: "orden_repuesto_disponible",
  REPUESTO_NO_DISPONIBLE: "orden_repuesto_no_disponible",
  AVISO_DEMORA: "orden_aviso_demora",
  REINGRESO_GARANTIA: "garantia_reingreso",
  CLIENTE_INACTIVO: "cliente_inactivo",
  SEGUIMIENTO_PRESUPUESTO_RECHAZADO: "orden_seguimiento_rechazado",
}

function buildVarsForContext(context: any): Record<string, string | number> {
  const currency: CurrencyCode = (context.moneda as CurrencyCode) || DEFAULT_CURRENCY
  const formatCurrency = (amount: number | null | undefined) =>
    formatCurrencyValue(amount ?? 0, currency)

  const baseUrl = getBaseUrl(context.organizationSlug)
  const publicToken: string | null | undefined = context.orden?.publicToken

  const vars: Record<string, string | number> = {
    cliente: context.cliente?.nombre || "",
    empresa: context.organizationName || "",
    fecha: new Date().toLocaleDateString("es-AR"),
  }

  if (context.orden) {
    vars.numero_orden = context.orden.numeroOrden ?? ""
    vars.dispositivo = context.orden.dispositivo || ""
    vars.estado = formatEstado(context.orden.estado || "")
    vars.presupuesto = context.orden.presupuesto != null
      ? formatCurrency(context.orden.presupuesto)
      : ""
    vars.link_seguimiento = publicToken ? `${baseUrl}/seguimiento/${publicToken}` : ""
    vars.link_pdf = publicToken ? `${baseUrl}/api/public/ordenes/${publicToken}/pdf` : ""
  }

  if (context.garantia) {
    vars.garantia_dias = context.garantia.diasValidez ?? ""
    vars.garantia_fecha = context.garantia.fechaVencimiento
      ? formatDateValue(context.garantia.fechaVencimiento, context.zonaHoraria)
      : ""
  }

  if (context.pago) {
    vars.monto_pago = context.pago.monto ? formatCurrency(context.pago.monto) : ""
    vars.saldo = context.pago.saldoPendiente
      ? formatCurrency(context.pago.saldoPendiente)
      : "Al día"
    vars.link_pago = context.pago.linkPago || ""
  }

  if (context.repuesto) {
    vars.repuesto = context.repuesto.nombre || "necesario"
  }

  if (context.demora) {
    vars.motivo_demora = context.demora.motivo || ""
  }

  if (context.promocion) {
    vars.promo_titulo = context.promocion.titulo || ""
    vars.promo_descripcion = context.promocion.descripcion || ""
  }

  return vars
}

function resolvePlantillaForTipo(
  tipo: string,
  context: any,
  plantillasOverride: Record<string, string> | null | undefined,
): string | null {
  if (!plantillasOverride) return null

  // Lookup especial para CAMBIO_ESTADO: primero buscar override por estado específico
  // (ej. orden_estado_recibido). Si no existe, cae al override genérico orden_estado_actual.
  if (tipo === "CAMBIO_ESTADO" && context.orden?.estado) {
    const estadoKey = `orden_estado_${String(context.orden.estado).toLowerCase()}`
    const tplEstado = plantillasOverride[estadoKey]
    if (tplEstado && tplEstado.trim()) {
      return renderTemplate(tplEstado, buildVarsForContext(context))
    }
  }

  const key = TIPO_TO_CATALOG_KEY[tipo]
  if (!key) return null
  const tpl = plantillasOverride[key]
  if (!tpl || !tpl.trim()) return null

  return renderTemplate(tpl, buildVarsForContext(context))
}

let _resend: Resend | null = null
function getResend(): Resend {
  if (!_resend) {
    _resend = new Resend(process.env.RESEND_API_KEY)
  }
  return _resend
}

type NotificationType = "CAMBIO_ESTADO" | "PRESUPUESTO_DEFINIDO" | "GARANTIA_CREADA" | "RECORDATORIO_RETIRO"

interface NotificationParams {
  organizationId: string
  ordenId?: string
  garantiaId?: string
  clienteId: string
  tipo: NotificationType
  context: {
    organizationName: string
    organizationSlug?: string | null
    moneda?: string
    zonaHoraria?: string
    cliente: {
      id: string
      nombre: string
      email?: string | null
      telefono: string
    }
    orden?: {
      id: string
      numeroOrden: number
      dispositivo: string
      estado: string
      estadoAnterior?: string
      presupuesto?: number | null
      fechaCompletado?: string | null
      publicToken?: string | null
      tecnicoId?: string | null
    }
    garantia?: {
      id: string
      diasValidez: number
      fechaVencimiento: string
    }
    pago?: {
      monto: number
      metodoPago?: string
      fechaPago?: string | Date
      saldoPendiente?: number
      linkPago?: string
    }
    repuesto?: {
      nombre: string
      disponible?: boolean
    }
    demora?: {
      motivo: string
      nuevaFechaEstimada?: string | Date
    }
    promocion?: {
      titulo: string
      descripcion: string
      descuento?: string
      validoHasta?: string | Date
    }
  }
}

/**
 * Enviar notificación directamente.
 * Se ejecuta como fire-and-forget desde las API routes.
 */
export async function sendNotificationDirect(params: NotificationParams) {
  const { organizationId, ordenId, garantiaId, clienteId, tipo, context } = params

  // Obtener configuración de la organización
  const { data: orgConfig } = await supabaseAdmin
    .from("organizations")
    .select("notificaciones_email, notificaciones_whatsapp, plantillas_whatsapp, pais")
    .eq("id", organizationId)
    .single()

  if (!orgConfig) {
    console.error("sendNotificationDirect: Organization not found", organizationId)
    return
  }

  // Enviar email si está habilitado
  if (orgConfig.notificaciones_email && context.cliente.email) {
    try {
      const { subject, html } = generateEmailContent(tipo, context)

      const { data, error } = await getResend().emails.send({
        from: `${context.organizationName} <notificaciones@${process.env.RESEND_DOMAIN || "resend.dev"}>`,
        to: context.cliente.email,
        subject,
        html,
      })

      await supabaseAdmin.from("notification_logs").insert({
        organization_id: organizationId,
        orden_id: ordenId,
        garantia_id: garantiaId,
        cliente_id: clienteId,
        tipo,
        canal: "EMAIL",
        estado: error ? "FALLIDO" : "ENVIADO",
        destinatario: context.cliente.email,
        asunto: subject,
        contenido: html,
        error_message: error?.message || null,
        metadata: JSON.stringify({ messageId: data?.id }),
      })
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error"
      console.error("sendNotificationDirect: Email error", errorMsg)
      await supabaseAdmin.from("notification_logs").insert({
        organization_id: organizationId,
        orden_id: ordenId,
        garantia_id: garantiaId,
        cliente_id: clienteId,
        tipo,
        canal: "EMAIL",
        estado: "FALLIDO",
        destinatario: context.cliente.email!,
        asunto: generateEmailContent(tipo, context).subject,
        contenido: "",
        error_message: errorMsg,
      })
    }
  }

  // WhatsApp si está habilitado
  if (orgConfig.notificaciones_whatsapp && context.cliente.telefono) {
    try {
      const { data: waConfig } = await supabaseAdmin
        .from("whatsapp_config")
        .select("provider, is_configured, is_verified, evolution_connection_state")
        .eq("organization_id", organizationId)
        .single()

      const provider = (waConfig?.provider || "meta") as "meta" | "evolution"
      const canSendViaApi =
        waConfig?.is_configured &&
        (provider === "evolution"
          ? waConfig.evolution_connection_state === "open"
          : waConfig.is_verified)

      if (canSendViaApi) {
        const { sendWhatsAppText } = await import("@/lib/whatsapp/providers")

        // Texto del mensaje: override de la org si existe, si no el generador rico
        // (copy por estado + link de seguimiento). Antes el path API usaba el
        // fallback pelado de NOTIFICATION_TEMPLATES (sin link y con "responda SI/NO"
        // que en Evolution no hace nada); unificado con el path wa.me.
        const overrideText = resolvePlantillaForTipo(tipo, context, orgConfig.plantillas_whatsapp)
        const fallbackText = overrideText ?? generateWhatsAppMessage(tipo, context)

        const result = await sendWhatsAppText(
          organizationId,
          context.cliente.telefono,
          fallbackText
        )

        await supabaseAdmin.from("notification_logs").insert({
          organization_id: organizationId,
          orden_id: ordenId,
          garantia_id: garantiaId,
          cliente_id: clienteId,
          tipo,
          canal: "WHATSAPP",
          estado: result.success ? "ENVIADO" : "FALLIDO",
          destinatario: context.cliente.telefono,
          contenido: fallbackText,
          metadata: JSON.stringify({ messageId: result.messageId, viaApi: true, provider: result.provider }),
          error_message: result.error || null,
        })

        if (result.success) {
          await supabaseAdmin.from("whatsapp_messages").insert({
            organization_id: organizationId,
            whatsapp_message_id: result.messageId,
            phone_number: context.cliente.telefono,
            status: "sent",
          })
        }
      } else {
        // Fallback: generar URL
        const overrideTextWa = resolvePlantillaForTipo(tipo, context, orgConfig.plantillas_whatsapp)
        const message = overrideTextWa ?? generateWhatsAppMessage(tipo, context)
        const { formatPhoneForWhatsApp } = await import("@/lib/notifications/whatsapp-templates")
        const formattedPhone = formatPhoneForWhatsApp(context.cliente.telefono, orgConfig.pais)
        const whatsappUrl = `https://wa.me/${formattedPhone}?text=${encodeURIComponent(message)}`

        await supabaseAdmin.from("notification_logs").insert({
          organization_id: organizationId,
          orden_id: ordenId,
          garantia_id: garantiaId,
          cliente_id: clienteId,
          tipo,
          canal: "WHATSAPP",
          estado: "PENDIENTE",
          destinatario: context.cliente.telefono,
          contenido: message,
          metadata: JSON.stringify({ whatsappUrl }),
        })
      }
    } catch (error) {
      console.error("sendNotificationDirect: WhatsApp error", error)
    }
  }

  // Crear notificaciones in-app
  try {
    const { data: users } = await supabaseAdmin
      .from("users")
      .select("id, rol")
      .eq("organization_id", organizationId)

    if (users && users.length > 0) {
      const targetUsers = users.filter((u) => {
        if (u.rol === "ADMIN") return true
        if (u.rol === "VENDEDOR" && ["CAMBIO_ESTADO", "PRESUPUESTO_DEFINIDO"].includes(tipo)) return true
        if (u.rol === "TECNICO" && tipo === "CAMBIO_ESTADO") return true
        return false
      })

      if (targetUsers.length > 0) {
        const { title, body, icon } = generateInAppContent(tipo, context)
        const actionUrl = ordenId ? `/ordenes/${ordenId}` : null

        const notifications = targetUsers.map((user) => ({
          organization_id: organizationId,
          user_id: user.id,
          title,
          body,
          type: tipo,
          icon,
          action_url: actionUrl,
          orden_id: ordenId || null,
          cliente_id: clienteId || null,
        }))

        await supabaseAdmin.from("user_notifications").insert(notifications)
      }

      // Push: solo cuando una orden pasa a APROBADO. Destinatarios: técnico
      // asignado de la orden + todos los ADMIN. Opt-in implícito vía suscripción
      // (sendPushToUsers devuelve 0 sin error si el usuario no tiene push).
      if (tipo === "CAMBIO_ESTADO" && context.orden?.estado === "APROBADO" && ordenId) {
        const adminIds = users.filter((u) => u.rol === "ADMIN").map((u) => u.id)
        const pushTargetIds = Array.from(
          new Set([context.orden.tecnicoId, ...adminIds].filter(Boolean) as string[])
        )
        if (pushTargetIds.length > 0) {
          const { title, body } = generateInAppContent(tipo, context)
          void sendPushToUsers(pushTargetIds, {
            title,
            body,
            path: `/ordenes/${ordenId}`,
            tag: `orden-${ordenId}`,
          }).catch((e) => console.error("sendNotificationDirect: push APROBADO error", e))
        }
      }
    }
  } catch (error) {
    console.error("sendNotificationDirect: In-app notification error", error)
  }
}

// --- Generadores de contenido ---

function generateInAppContent(
  tipo: string,
  context: NotificationParams["context"]
): { title: string; body: string; icon: string } {
  switch (tipo) {
    case "CAMBIO_ESTADO":
      return {
        title: `Orden #${context.orden?.numeroOrden} - ${formatEstado(context.orden?.estado || "")}`,
        body: `${context.cliente.nombre} - ${context.orden?.dispositivo}`,
        icon: "clipboard-list",
      }
    case "PRESUPUESTO_DEFINIDO":
      return {
        title: `Presupuesto definido - Orden #${context.orden?.numeroOrden}`,
        body: `${context.cliente.nombre} - $${context.orden?.presupuesto?.toLocaleString() || "0"}`,
        icon: "receipt",
      }
    case "GARANTIA_CREADA":
      return {
        title: `Garantia creada - Orden #${context.orden?.numeroOrden}`,
        body: `${context.cliente.nombre} - ${context.garantia?.diasValidez} dias`,
        icon: "shield",
      }
    case "RECORDATORIO_RETIRO":
      return {
        title: `Recordatorio de retiro - Orden #${context.orden?.numeroOrden}`,
        body: `${context.cliente.nombre} - ${context.orden?.dispositivo}`,
        icon: "clock",
      }
    default:
      return { title: "Nueva notificacion", body: context.cliente.nombre, icon: "bell" }
  }
}

function generateEmailContent(
  tipo: string,
  context: NotificationParams["context"]
): { subject: string; html: string } {
  const baseStyle = `
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    max-width: 600px;
    margin: 0 auto;
    padding: 20px;
  `

  switch (tipo) {
    case "CAMBIO_ESTADO":
      return {
        subject: `Orden #${context.orden?.numeroOrden} - Estado actualizado`,
        html: `
          <div style="${baseStyle}">
            <h2>Hola ${context.cliente.nombre}</h2>
            <p>Tu orden <strong>#${context.orden?.numeroOrden}</strong> ha cambiado de estado.</p>
            <p>
              <strong>Dispositivo:</strong> ${context.orden?.dispositivo}<br>
              <strong>Nuevo estado:</strong> ${formatEstado(context.orden?.estado || "")}
            </p>
            <p>Gracias por confiar en ${context.organizationName}.</p>
          </div>
        `,
      }
    case "PRESUPUESTO_DEFINIDO":
      return {
        subject: `Orden #${context.orden?.numeroOrden} - Presupuesto definido`,
        html: `
          <div style="${baseStyle}">
            <h2>Hola ${context.cliente.nombre}</h2>
            <p>Se ha definido el presupuesto para tu orden <strong>#${context.orden?.numeroOrden}</strong>.</p>
            <p>
              <strong>Dispositivo:</strong> ${context.orden?.dispositivo}<br>
              <strong>Presupuesto:</strong> $${context.orden?.presupuesto?.toLocaleString()}
            </p>
            <p>Por favor confirma si deseas proceder con la reparación.</p>
            <p>Gracias por confiar en ${context.organizationName}.</p>
          </div>
        `,
      }
    case "GARANTIA_CREADA":
      return {
        subject: `Orden #${context.orden?.numeroOrden} - Garantía activa`,
        html: `
          <div style="${baseStyle}">
            <h2>Hola ${context.cliente.nombre}</h2>
            <p>Tu reparación ha sido completada y se ha creado una garantía.</p>
            <p>
              <strong>Orden:</strong> #${context.orden?.numeroOrden}<br>
              <strong>Dispositivo:</strong> ${context.orden?.dispositivo}<br>
              <strong>Días de garantía:</strong> ${context.garantia?.diasValidez}<br>
              <strong>Vencimiento:</strong> ${formatDateValue(context.garantia?.fechaVencimiento, context.zonaHoraria)}
            </p>
            <p>Guarda este correo como comprobante de tu garantía.</p>
            <p>Gracias por confiar en ${context.organizationName}.</p>
          </div>
        `,
      }
    case "RECORDATORIO_RETIRO":
      return {
        subject: `Recordatorio: Tu dispositivo está listo para retirar`,
        html: `
          <div style="${baseStyle}">
            <h2>Hola ${context.cliente.nombre}</h2>
            <p>Te recordamos que tu dispositivo ya está listo para ser retirado.</p>
            <p>
              <strong>Orden:</strong> #${context.orden?.numeroOrden}<br>
              <strong>Dispositivo:</strong> ${context.orden?.dispositivo}
            </p>
            <p>Te esperamos en ${context.organizationName}.</p>
          </div>
        `,
      }
    default:
      return {
        subject: `Notificación de ${context.organizationName}`,
        html: `<div style="${baseStyle}"><p>Tienes una nueva notificación.</p></div>`,
      }
  }
}

