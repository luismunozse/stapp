import { supabaseAdmin } from "@/lib/supabase"
import { Resend } from "resend"
import { formatDateValue } from "@/lib/timezone"

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
    }
    garantia?: {
      id: string
      diasValidez: number
      fechaVencimiento: string
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
    .select("notificaciones_email, notificaciones_whatsapp")
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
        .select("phone_number_id, access_token_encrypted, is_configured, is_verified")
        .eq("organization_id", organizationId)
        .single()

      if (waConfig?.is_configured && waConfig?.is_verified && waConfig.access_token_encrypted) {
        const { decrypt } = await import("@/lib/whatsapp/encryption")
        const { sendTextMessage } = await import("@/lib/whatsapp/client")
        const { NOTIFICATION_TEMPLATES } = await import("@/lib/whatsapp/templates")

        const accessToken = decrypt(waConfig.access_token_encrypted)
        const template = NOTIFICATION_TEMPLATES[tipo]
        const fallbackText = template
          ? template.getFallbackText({
              ...context.orden,
              organizationName: context.organizationName,
              moneda: context.moneda,
              ...context.garantia,
            })
          : generateWhatsAppMessage(tipo, context)

        const result = await sendTextMessage(
          waConfig.phone_number_id,
          accessToken,
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
          metadata: JSON.stringify({ messageId: result.messageId, viaApi: true }),
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
        const message = generateWhatsAppMessage(tipo, context)
        const cleanPhone = context.cliente.telefono.replace(/\D/g, "")
        const whatsappUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`

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

function generateWhatsAppMessage(
  tipo: string,
  context: NotificationParams["context"]
): string {
  switch (tipo) {
    case "CAMBIO_ESTADO":
      return `Hola ${context.cliente.nombre}!\n\nTu orden #${context.orden?.numeroOrden} (${context.orden?.dispositivo}) ha cambiado a: *${formatEstado(context.orden?.estado || "")}*\n\n${context.organizationName}`
    case "PRESUPUESTO_DEFINIDO":
      return `Hola ${context.cliente.nombre}!\n\nSe ha definido el presupuesto para tu orden #${context.orden?.numeroOrden} (${context.orden?.dispositivo}):\n\n*$${context.orden?.presupuesto?.toLocaleString()}*\n\n¿Deseas proceder con la reparación?\n\n${context.organizationName}`
    case "GARANTIA_CREADA":
      return `Hola ${context.cliente.nombre}!\n\nTu reparación ha sido completada\n\nOrden: #${context.orden?.numeroOrden}\nDispositivo: ${context.orden?.dispositivo}\nGarantía: ${context.garantia?.diasValidez} días\n\nGuarda este mensaje como comprobante.\n\n${context.organizationName}`
    case "RECORDATORIO_RETIRO":
      return `Hola ${context.cliente.nombre}!\n\nTe recordamos que tu dispositivo (${context.orden?.dispositivo}) ya está listo para retirar.\n\nOrden: #${context.orden?.numeroOrden}\n\nTe esperamos!\n\n${context.organizationName}`
    default:
      return `Hola ${context.cliente.nombre}, tienes una nueva notificación de ${context.organizationName}.`
  }
}

function formatEstado(estado: string): string {
  const estados: Record<string, string> = {
    RECIBIDO: "Recibido",
    EN_DIAGNOSTICO: "En Diagnóstico",
    PRESUPUESTADO: "Presupuestado",
    APROBADO: "Aprobado",
    EN_REPARACION: "En Reparación",
    ESPERANDO_REPUESTO: "Esperando Repuesto",
    REPARADO: "Reparado",
    ENTREGADO: "Entregado",
    CANCELADO: "Cancelado",
    SIN_REPARACION: "Sin Reparación",
  }
  return estados[estado] || estado
}
