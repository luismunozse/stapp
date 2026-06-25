import { supabaseAdmin } from "@/lib/supabase"
import { Resend } from "resend"
import { formatDateValue } from "@/lib/timezone"
import { sendPushToUsers } from "@/lib/push/send"
import { generateWhatsAppMessage, formatEstado, resolvePlantillaForTipo } from "@/lib/notifications/whatsapp-message"
import { escapeHtml } from "@/lib/escape-html"

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
  let aceptaWhatsapp = true
  if (clienteId) {
    const { data: cli } = await supabaseAdmin
      .from("clientes")
      .select("acepta_whatsapp")
      .eq("id", clienteId)
      .single()
    aceptaWhatsapp = cli?.acepta_whatsapp ?? true
  }

  if (orgConfig.notificaciones_whatsapp && context.cliente.telefono && aceptaWhatsapp) {
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

        // Texto del mensaje: catálogo como única fuente de verdad (override de la org
        // si existe, si no el defaultText del catálogo por estado). La función ya
        // cae al catálogo cuando no hay override, y generateWhatsAppMessage es el
        // último fallback genérico para tipos sin entrada en el catálogo.
        const resolvedText = resolvePlantillaForTipo(tipo, context, orgConfig.plantillas_whatsapp)
        const fallbackText = resolvedText ?? generateWhatsAppMessage(tipo, context)

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
        const resolvedText = resolvePlantillaForTipo(tipo, context, orgConfig.plantillas_whatsapp)
        const message = resolvedText ?? generateWhatsAppMessage(tipo, context)
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

export function generateEmailContent(
  tipo: string,
  context: NotificationParams["context"]
): { subject: string; html: string } {
  const baseStyle = `
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    max-width: 600px;
    margin: 0 auto;
    padding: 20px;
  `

  // Escape all client-controlled string fields before interpolating into HTML.
  // Numeric fields (numeroOrden, presupuesto, diasValidez) are left as-is —
  // they are safe but the escapeHtml wrapper is harmless for strings.
  const nombre = escapeHtml(context.cliente.nombre)
  const orgName = escapeHtml(context.organizationName)
  const dispositivo = escapeHtml(context.orden?.dispositivo)
  const estado = escapeHtml(formatEstado(context.orden?.estado || ""))
  const fechaVencimiento = escapeHtml(
    formatDateValue(context.garantia?.fechaVencimiento ?? "", context.zonaHoraria)
  )

  switch (tipo) {
    case "CAMBIO_ESTADO":
      return {
        subject: `Orden #${context.orden?.numeroOrden} - Estado actualizado`,
        html: `
          <div style="${baseStyle}">
            <h2>Hola ${nombre}</h2>
            <p>Tu orden <strong>#${context.orden?.numeroOrden}</strong> ha cambiado de estado.</p>
            <p>
              <strong>Dispositivo:</strong> ${dispositivo}<br>
              <strong>Nuevo estado:</strong> ${estado}
            </p>
            <p>Gracias por confiar en ${orgName}.</p>
          </div>
        `,
      }
    case "PRESUPUESTO_DEFINIDO":
      return {
        subject: `Orden #${context.orden?.numeroOrden} - Presupuesto definido`,
        html: `
          <div style="${baseStyle}">
            <h2>Hola ${nombre}</h2>
            <p>Se ha definido el presupuesto para tu orden <strong>#${context.orden?.numeroOrden}</strong>.</p>
            <p>
              <strong>Dispositivo:</strong> ${dispositivo}<br>
              <strong>Presupuesto:</strong> $${context.orden?.presupuesto?.toLocaleString()}
            </p>
            <p>Por favor confirma si deseas proceder con la reparación.</p>
            <p>Gracias por confiar en ${orgName}.</p>
          </div>
        `,
      }
    case "GARANTIA_CREADA":
      return {
        subject: `Orden #${context.orden?.numeroOrden} - Garantía activa`,
        html: `
          <div style="${baseStyle}">
            <h2>Hola ${nombre}</h2>
            <p>Tu reparación ha sido completada y se ha creado una garantía.</p>
            <p>
              <strong>Orden:</strong> #${context.orden?.numeroOrden}<br>
              <strong>Dispositivo:</strong> ${dispositivo}<br>
              <strong>Días de garantía:</strong> ${context.garantia?.diasValidez}<br>
              <strong>Vencimiento:</strong> ${fechaVencimiento}
            </p>
            <p>Guarda este correo como comprobante de tu garantía.</p>
            <p>Gracias por confiar en ${orgName}.</p>
          </div>
        `,
      }
    case "RECORDATORIO_RETIRO":
      return {
        subject: `Recordatorio: Tu dispositivo está listo para retirar`,
        html: `
          <div style="${baseStyle}">
            <h2>Hola ${nombre}</h2>
            <p>Te recordamos que tu dispositivo ya está listo para ser retirado.</p>
            <p>
              <strong>Orden:</strong> #${context.orden?.numeroOrden}<br>
              <strong>Dispositivo:</strong> ${dispositivo}
            </p>
            <p>Te esperamos en ${orgName}.</p>
          </div>
        `,
      }
    default:
      return {
        subject: `Notificación de ${orgName}`,
        html: `<div style="${baseStyle}"><p>Tienes una nueva notificación.</p></div>`,
      }
  }
}

