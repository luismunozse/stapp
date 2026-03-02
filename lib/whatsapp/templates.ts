/**
 * Mapeo de tipos de notificación a templates de WhatsApp Business.
 * Los templates deben estar aprobados en Meta Business Manager.
 */

import type { TemplateComponent } from "./client"

interface WaTemplateConfig {
  templateName: string
  getComponents: (context: Record<string, unknown>) => TemplateComponent[]
  getFallbackText: (context: Record<string, unknown>) => string
}

export const NOTIFICATION_TEMPLATES: Record<string, WaTemplateConfig> = {
  CAMBIO_ESTADO: {
    templateName: "cambio_estado",
    getComponents: (ctx) => [
      {
        type: "body",
        parameters: [
          { type: "text", text: String(ctx.numeroOrden || "") },
          { type: "text", text: String(ctx.dispositivo || "") },
          { type: "text", text: getEstadoLabel(String(ctx.estado || "")) },
        ],
      },
    ],
    getFallbackText: (ctx) =>
      `Hola! Tu orden #${ctx.numeroOrden} (${ctx.dispositivo}) cambió a: *${getEstadoLabel(String(ctx.estado || ""))}*.${
        ctx.estado === "REPARADO"
          ? "\n\n¡Tu equipo está listo para retirar! 🎉"
          : ""
      }\n\nGracias por confiar en ${ctx.organizationName}`,
  },

  PRESUPUESTO_DEFINIDO: {
    templateName: "presupuesto_definido",
    getComponents: (ctx) => [
      {
        type: "body",
        parameters: [
          { type: "text", text: String(ctx.numeroOrden || "") },
          { type: "text", text: formatPrice(ctx.presupuesto as number, ctx.moneda as string) },
        ],
      },
    ],
    getFallbackText: (ctx) =>
      `Hola! El presupuesto para tu orden #${ctx.numeroOrden} (${ctx.dispositivo}) es de *${formatPrice(ctx.presupuesto as number, ctx.moneda as string)}*.\n\nResponde *SI* para aprobar o *NO* para rechazar.\n\n${ctx.organizationName}`,
  },

  GARANTIA_CREADA: {
    templateName: "garantia_creada",
    getComponents: (ctx) => [
      {
        type: "body",
        parameters: [
          { type: "text", text: String(ctx.diasValidez || 30) },
          { type: "text", text: String(ctx.fechaVencimiento || "") },
        ],
      },
    ],
    getFallbackText: (ctx) =>
      `Hola! Tu reparación tiene *${ctx.diasValidez} días de garantía* (hasta ${ctx.fechaVencimiento}).\n\nConservá este mensaje como comprobante.\n\n${ctx.organizationName}`,
  },

  RECORDATORIO_RETIRO: {
    templateName: "recordatorio_retiro",
    getComponents: (ctx) => [
      {
        type: "body",
        parameters: [
          { type: "text", text: String(ctx.dispositivo || "") },
          { type: "text", text: String(ctx.numeroOrden || "") },
        ],
      },
    ],
    getFallbackText: (ctx) =>
      `Hola! Tu ${ctx.dispositivo} (Orden #${ctx.numeroOrden}) está listo para retirar.\n\n¿Cuándo podés pasar a buscarlo?\n\n${ctx.organizationName}`,
  },
}

const estadoLabels: Record<string, string> = {
  RECIBIDO: "Recibido",
  EN_DIAGNOSTICO: "En Diagnóstico",
  PRESUPUESTADO: "Presupuestado",
  APROBADO: "Aprobado",
  EN_REPARACION: "En Reparación",
  ESPERANDO_REPUESTO: "Esperando Repuesto",
  REPARADO: "Listo para retirar",
  ENTREGADO: "Entregado",
  CANCELADO: "Cancelado",
  SIN_REPARACION: "Sin Reparación",
}

function getEstadoLabel(estado: string): string {
  return estadoLabels[estado] || estado
}

function formatPrice(amount: number | null | undefined, currency: string = "ARS"): string {
  if (amount == null) return "Sin definir"
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
  }).format(amount)
}
