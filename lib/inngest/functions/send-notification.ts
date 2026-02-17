import { inngest } from "../client"
import { supabaseAdmin } from "@/lib/supabase"
import { Resend } from "resend"
import { formatDateValue } from "@/lib/timezone"

// Lazy initialization to avoid errors during build
let _resend: Resend | null = null
function getResend(): Resend {
  if (!_resend) {
    _resend = new Resend(process.env.RESEND_API_KEY)
  }
  return _resend
}

/**
 * Función de Inngest para enviar notificaciones
 * Se ejecuta en background con reintentos automáticos
 */
export const sendNotification = inngest.createFunction(
  {
    id: "send-notification",
    name: "Send Notification",
    retries: 3,
  },
  { event: "notification/send" },
  async ({ event, step }) => {
    const { organizationId, ordenId, garantiaId, clienteId, tipo, context } = event.data

    // Paso 1: Obtener configuración de la organización
    const orgConfig = await step.run("get-org-config", async () => {
      const { data } = await supabaseAdmin
        .from("organizations")
        .select("notificaciones_email, notificaciones_whatsapp")
        .eq("id", organizationId)
        .single()

      return data
    })

    if (!orgConfig) {
      return { success: false, error: "Organization not found" }
    }

    const results: Array<{
      channel: "EMAIL" | "WHATSAPP"
      success: boolean
      error?: string
    }> = []

    // Paso 2: Enviar email si está habilitado
    if (orgConfig.notificaciones_email && context.cliente.email) {
      const emailResult = await step.run("send-email", async () => {
        try {
          const { subject, html } = generateEmailContent(tipo, context)

          const { data, error } = await getResend().emails.send({
            from: `${context.organizationName} <notificaciones@${process.env.RESEND_DOMAIN || "resend.dev"}>`,
            to: context.cliente.email!,
            subject,
            html,
          })

          if (error) {
            throw new Error(error.message)
          }

          // Registrar en notification_logs
          await supabaseAdmin.from("notification_logs").insert({
            organization_id: organizationId,
            orden_id: ordenId,
            garantia_id: garantiaId,
            cliente_id: clienteId,
            tipo,
            canal: "EMAIL",
            estado: "ENVIADO",
            destinatario: context.cliente.email!,
            asunto: subject,
            contenido: html,
            metadata: JSON.stringify({ messageId: data?.id }),
          })

          return { success: true }
        } catch (error) {
          // Registrar fallo
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
            error_message: error instanceof Error ? error.message : "Unknown error",
          })

          return { success: false, error: error instanceof Error ? error.message : "Unknown error" }
        }
      })

      results.push({ channel: "EMAIL", ...emailResult })
    }

    // Paso 3: Generar URL de WhatsApp si está habilitado
    if (orgConfig.notificaciones_whatsapp && context.cliente.telefono) {
      const whatsappResult = await step.run("generate-whatsapp", async () => {
        try {
          const message = generateWhatsAppMessage(tipo, context)
          const whatsappUrl = generateWhatsAppUrl(context.cliente.telefono, message)

          // Registrar en notification_logs (como pendiente porque requiere acción manual)
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

          return { success: true, whatsappUrl }
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : "Unknown error" }
        }
      })

      results.push({ channel: "WHATSAPP", ...whatsappResult })
    }

    return { success: true, results }
  }
)

/**
 * Generar contenido de email según el tipo de notificación
 */
function generateEmailContent(
  tipo: string,
  context: {
    organizationName: string
    zonaHoraria?: string
    cliente: { nombre: string }
    orden?: {
      numeroOrden: number
      dispositivo: string
      estado: string
      presupuesto?: number | null
    }
    garantia?: {
      diasValidez: number
      fechaVencimiento: string
    }
  }
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

/**
 * Generar mensaje de WhatsApp según el tipo
 */
function generateWhatsAppMessage(
  tipo: string,
  context: {
    organizationName: string
    cliente: { nombre: string }
    orden?: {
      numeroOrden: number
      dispositivo: string
      estado: string
      presupuesto?: number | null
    }
    garantia?: {
      diasValidez: number
    }
  }
): string {
  switch (tipo) {
    case "CAMBIO_ESTADO":
      return `Hola ${context.cliente.nombre}! 👋\n\nTu orden #${context.orden?.numeroOrden} (${context.orden?.dispositivo}) ha cambiado a: *${formatEstado(context.orden?.estado || "")}*\n\n${context.organizationName}`

    case "PRESUPUESTO_DEFINIDO":
      return `Hola ${context.cliente.nombre}! 👋\n\nSe ha definido el presupuesto para tu orden #${context.orden?.numeroOrden} (${context.orden?.dispositivo}):\n\n💰 *$${context.orden?.presupuesto?.toLocaleString()}*\n\n¿Deseas proceder con la reparación?\n\n${context.organizationName}`

    case "GARANTIA_CREADA":
      return `Hola ${context.cliente.nombre}! 👋\n\nTu reparación ha sido completada ✅\n\nOrden: #${context.orden?.numeroOrden}\nDispositivo: ${context.orden?.dispositivo}\nGarantía: ${context.garantia?.diasValidez} días\n\nGuarda este mensaje como comprobante.\n\n${context.organizationName}`

    case "RECORDATORIO_RETIRO":
      return `Hola ${context.cliente.nombre}! 👋\n\nTe recordamos que tu dispositivo (${context.orden?.dispositivo}) ya está listo para retirar.\n\nOrden: #${context.orden?.numeroOrden}\n\nTe esperamos! 🙂\n\n${context.organizationName}`

    default:
      return `Hola ${context.cliente.nombre}, tienes una nueva notificación de ${context.organizationName}.`
  }
}

/**
 * Generar URL de WhatsApp Web/App
 */
function generateWhatsAppUrl(telefono: string, mensaje: string): string {
  // Limpiar número de teléfono
  const cleanPhone = telefono.replace(/\D/g, "")
  const encodedMessage = encodeURIComponent(mensaje)
  return `https://wa.me/${cleanPhone}?text=${encodedMessage}`
}

/**
 * Formatear estado para mostrar
 */
function formatEstado(estado: string): string {
  const estados: Record<string, string> = {
    PENDIENTE: "Pendiente",
    EN_REPARACION: "En Reparación",
    ESPERANDO_REPUESTO: "Esperando Repuesto",
    COMPLETADO: "Completado",
    ENTREGADO: "Entregado",
    CANCELADO: "Cancelado",
  }
  return estados[estado] || estado
}
