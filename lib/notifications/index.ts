import { Resend } from "resend"
import { supabaseAdmin } from "@/lib/supabase"
import {
  NotificationType,
  NotificationChannel,
  NotificationContext,
  NotificationResult,
  NotificationConfig,
} from "./types"
import {
  generateCambioEstadoEmail,
  generatePresupuestoEmail,
  generateGarantiaEmail,
  generateRecordatorioEmail,
} from "./email-templates"
import { getWhatsAppTemplates, generateWhatsAppUrl } from "./whatsapp-templates"

const resend = new Resend(process.env.RESEND_API_KEY)

export class NotificationService {
  private organizationId: string
  private config: NotificationConfig | null = null

  constructor(organizationId: string) {
    this.organizationId = organizationId
  }

  async getConfig(): Promise<NotificationConfig> {
    if (this.config) return this.config

    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("notificaciones_email, notificaciones_whatsapp, dias_recordatorio")
      .eq("id", this.organizationId)
      .single()

    this.config = {
      emailEnabled: org?.notificaciones_email ?? true,
      whatsappEnabled: org?.notificaciones_whatsapp ?? true,
      diasRecordatorio: org?.dias_recordatorio ?? 3,
    }

    return this.config
  }

  async sendNotification(
    type: NotificationType,
    context: NotificationContext,
    channels: NotificationChannel[] = ["EMAIL"]
  ): Promise<NotificationResult[]> {
    const config = await this.getConfig()
    const results: NotificationResult[] = []

    for (const channel of channels) {
      if (channel === "EMAIL" && config.emailEnabled) {
        const result = await this.sendEmail(type, context)
        results.push(result)
      }

      if (channel === "WHATSAPP" && config.whatsappEnabled) {
        const result = await this.generateWhatsAppLink(type, context)
        results.push(result)
      }
    }

    return results
  }

  private async sendEmail(
    type: NotificationType,
    context: NotificationContext
  ): Promise<NotificationResult> {
    if (!context.cliente.email) {
      return {
        success: false,
        channel: "EMAIL",
        error: "Cliente sin email registrado",
      }
    }

    let emailContent: { subject: string; html: string }

    switch (type) {
      case "CAMBIO_ESTADO":
        emailContent = generateCambioEstadoEmail(context)
        break
      case "PRESUPUESTO_DEFINIDO":
        emailContent = generatePresupuestoEmail(context)
        break
      case "GARANTIA_CREADA":
        emailContent = generateGarantiaEmail(context)
        break
      case "RECORDATORIO_RETIRO":
        // Calcular dias desde completado
        const fechaCompletado = context.orden?.fechaCompletado
        const diasCompletado = fechaCompletado
          ? Math.floor(
              (Date.now() - new Date(fechaCompletado).getTime()) /
                (1000 * 60 * 60 * 24)
            )
          : 0
        emailContent = generateRecordatorioEmail(context, diasCompletado)
        break
      default:
        return {
          success: false,
          channel: "EMAIL",
          error: "Tipo de notificacion no soportado",
        }
    }

    try {
      const { data, error } = await resend.emails.send({
        from: process.env.EMAIL_FROM || "Servicio Tecnico <onboarding@resend.dev>",
        to: context.cliente.email,
        subject: emailContent.subject,
        html: emailContent.html,
      })

      if (error) {
        await this.logNotification({
          type,
          channel: "EMAIL",
          context,
          success: false,
          error: error.message,
          content: emailContent.html,
          subject: emailContent.subject,
        })

        return {
          success: false,
          channel: "EMAIL",
          error: error.message,
        }
      }

      await this.logNotification({
        type,
        channel: "EMAIL",
        context,
        success: true,
        messageId: data?.id,
        content: emailContent.html,
        subject: emailContent.subject,
      })

      return {
        success: true,
        channel: "EMAIL",
        messageId: data?.id,
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Error desconocido"

      await this.logNotification({
        type,
        channel: "EMAIL",
        context,
        success: false,
        error: errorMessage,
        content: emailContent.html,
        subject: emailContent.subject,
      })

      return {
        success: false,
        channel: "EMAIL",
        error: errorMessage,
      }
    }
  }

  private async generateWhatsAppLink(
    type: NotificationType,
    context: NotificationContext
  ): Promise<NotificationResult> {
    const templates = getWhatsAppTemplates(context)

    // Seleccionar plantilla segun tipo
    let templateId: string
    switch (type) {
      case "CAMBIO_ESTADO":
        templateId = "estado_actual"
        break
      case "PRESUPUESTO_DEFINIDO":
        templateId = "presupuesto"
        break
      case "GARANTIA_CREADA":
        templateId = "garantia"
        break
      case "RECORDATORIO_RETIRO":
        templateId = "listo_retirar"
        break
      default:
        templateId = "seguimiento"
    }

    const template =
      templates.find((t) => t.id === templateId) || templates[0]

    if (!template) {
      return {
        success: false,
        channel: "WHATSAPP",
        error: "No hay plantillas disponibles",
      }
    }

    const whatsappUrl = generateWhatsAppUrl(
      context.cliente.telefono,
      template.mensaje
    )

    // Registrar como pendiente (se marca enviado cuando el usuario hace click)
    await this.logNotification({
      type,
      channel: "WHATSAPP",
      context,
      success: true,
      content: template.mensaje,
    })

    return {
      success: true,
      channel: "WHATSAPP",
      whatsappUrl,
    }
  }

  private async logNotification(params: {
    type: NotificationType
    channel: NotificationChannel
    context: NotificationContext
    success: boolean
    messageId?: string
    error?: string
    content: string
    subject?: string
  }): Promise<void> {
    try {
      await supabaseAdmin.from("notification_logs").insert({
        organization_id: this.organizationId,
        orden_id: params.context.orden?.id || null,
        garantia_id: params.context.garantia?.id || null,
        cliente_id: params.context.cliente.id,
        tipo: params.type,
        canal: params.channel,
        estado: params.success ? "ENVIADO" : "FALLIDO",
        destinatario:
          params.channel === "EMAIL"
            ? params.context.cliente.email || ""
            : params.context.cliente.telefono,
        asunto: params.subject || null,
        contenido: params.content,
        error_message: params.error || null,
        metadata: JSON.stringify({
          messageId: params.messageId,
          ordenNumero: params.context.orden?.numeroOrden,
        }),
      })
    } catch (err) {
      console.error("Error logging notification:", err)
    }
  }

  // Metodo para obtener historial de notificaciones
  async getNotificationHistory(ordenId?: string, limit = 50) {
    let query = supabaseAdmin
      .from("notification_logs")
      .select(`
        *,
        ordenes_servicio (numero_orden),
        clientes (nombre)
      `)
      .eq("organization_id", this.organizationId)
      .order("created_at", { ascending: false })
      .limit(limit)

    if (ordenId) {
      query = query.eq("orden_id", ordenId)
    }

    const { data } = await query
    return data || []
  }
}

// Helper para crear contexto desde orden
export async function createNotificationContext(
  ordenId: string
): Promise<NotificationContext | null> {
  const { data: orden } = await supabaseAdmin
    .from("ordenes_servicio")
    .select(`
      *,
      clientes (*),
      organizations (nombre_mostrar),
      garantias (id, dias_validez, fecha_vencimiento)
    `)
    .eq("id", ordenId)
    .single()

  if (!orden) return null

  const garantia = orden.garantias?.[0] || null

  return {
    organizationId: orden.organization_id,
    organizationName: orden.organizations?.nombre_mostrar,
    cliente: {
      id: orden.clientes.id,
      nombre: orden.clientes.nombre,
      email: orden.clientes.email,
      telefono: orden.clientes.telefono,
    },
    orden: {
      id: orden.id,
      numeroOrden: orden.numero_orden,
      dispositivo: orden.dispositivo,
      estado: orden.estado as any,
      presupuesto: orden.presupuesto,
      fechaCompletado: orden.fecha_completado,
    },
    ...(garantia && {
      garantia: {
        id: garantia.id,
        diasValidez: garantia.dias_validez,
        fechaVencimiento: garantia.fecha_vencimiento,
      },
    }),
  }
}

export * from "./types"
export * from "./whatsapp-templates"
