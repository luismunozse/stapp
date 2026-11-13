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
      `¡Hola! Tu orden #${ctx.numeroOrden} (${ctx.dispositivo}) cambió a: *${getEstadoLabel(String(ctx.estado || ""))}*.${
        ctx.estado === "REPARADO"
          ? "\n\n¡Tu equipo está listo para retirar!"
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
      `¡Hola! El presupuesto para tu orden #${ctx.numeroOrden} (${ctx.dispositivo}) es de *${formatPrice(ctx.presupuesto as number, ctx.moneda as string)}*.\n\nRespondé *SÍ* para aprobar o *NO* para rechazar.\n\n${ctx.organizationName}`,
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
      `¡Hola! Tu reparación tiene *${ctx.diasValidez} días de garantía* (hasta ${ctx.fechaVencimiento}).\n\nConservá este mensaje como comprobante.\n\n${ctx.organizationName}`,
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
      `¡Hola! Tu ${ctx.dispositivo} (Orden #${ctx.numeroOrden}) está listo para retirar.\n\nPodés pasar a retirarlo en horario de atención.\n\n${ctx.organizationName}`,
  },

  // --- Pre-venta y captación ---

  BIENVENIDA_CLIENTE: {
    templateName: "bienvenida_cliente",
    getComponents: (ctx) => [
      {
        type: "body",
        parameters: [
          { type: "text", text: String(ctx.clienteNombre || "") },
          { type: "text", text: String(ctx.organizationName || "") },
        ],
      },
    ],
    getFallbackText: (ctx) =>
      `¡Hola ${ctx.clienteNombre}! Bienvenido/a a ${ctx.organizationName}. Gracias por confiar en nosotros. Podés contactarnos por este medio para cualquier consulta.\n\n${ctx.organizationName}`,
  },

  RESPUESTA_CONSULTA: {
    templateName: "respuesta_consulta",
    getComponents: (ctx) => [
      {
        type: "body",
        parameters: [
          { type: "text", text: String(ctx.clienteNombre || "") },
        ],
      },
    ],
    getFallbackText: (ctx) =>
      `¡Hola ${ctx.clienteNombre}! Gracias por tu consulta. Si querés traer tu equipo para una revisión sin cargo, estamos a tu disposición.\n\n${ctx.organizationName}`,
  },

  // --- Cobranza y pagos ---

  RECORDATORIO_PAGO: {
    templateName: "recordatorio_pago",
    getComponents: (ctx) => [
      {
        type: "body",
        parameters: [
          { type: "text", text: String(ctx.clienteNombre || "") },
          { type: "text", text: formatPrice(ctx.saldoPendiente as number, ctx.moneda as string) },
          { type: "text", text: String(ctx.numeroOrden || "") },
        ],
      },
    ],
    getFallbackText: (ctx) =>
      `¡Hola ${ctx.clienteNombre}! Te recordamos que tenés un saldo pendiente de *${formatPrice(ctx.saldoPendiente as number, ctx.moneda as string)}*${ctx.numeroOrden ? ` (Orden #${ctx.numeroOrden})` : ""}.\n\n${ctx.organizationName}`,
  },

  CONFIRMACION_PAGO: {
    templateName: "confirmacion_pago",
    getComponents: (ctx) => [
      {
        type: "body",
        parameters: [
          { type: "text", text: String(ctx.clienteNombre || "") },
          { type: "text", text: formatPrice(ctx.montoPago as number, ctx.moneda as string) },
        ],
      },
    ],
    getFallbackText: (ctx) =>
      `¡Hola ${ctx.clienteNombre}! Confirmamos la recepción de tu pago por *${formatPrice(ctx.montoPago as number, ctx.moneda as string)}*. ¡Gracias!\n\n${ctx.organizationName}`,
  },

  LINK_PAGO: {
    templateName: "link_pago",
    getComponents: (ctx) => [
      {
        type: "body",
        parameters: [
          { type: "text", text: String(ctx.clienteNombre || "") },
          { type: "text", text: formatPrice(ctx.montoPago as number, ctx.moneda as string) },
          { type: "text", text: String(ctx.linkPago || "") },
        ],
      },
    ],
    getFallbackText: (ctx) =>
      `¡Hola ${ctx.clienteNombre}! Te enviamos el link para realizar el pago de *${formatPrice(ctx.montoPago as number, ctx.moneda as string)}*:\n\n${ctx.linkPago}\n\n${ctx.organizationName}`,
  },

  // --- Retención y fidelización ---

  MANTENIMIENTO_PREVENTIVO: {
    templateName: "mantenimiento_preventivo",
    getComponents: (ctx) => [
      {
        type: "body",
        parameters: [
          { type: "text", text: String(ctx.clienteNombre || "") },
          { type: "text", text: String(ctx.organizationName || "") },
        ],
      },
    ],
    getFallbackText: (ctx) =>
      `¡Hola ${ctx.clienteNombre}! Desde ${ctx.organizationName} te recordamos que es buen momento para un chequeo preventivo de tu equipo. ¡Consultanos por un turno!\n\n${ctx.organizationName}`,
  },

  PROMOCION: {
    templateName: "promocion",
    getComponents: (ctx) => [
      {
        type: "body",
        parameters: [
          { type: "text", text: String(ctx.clienteNombre || "") },
          { type: "text", text: String(ctx.promoTitulo || "") },
          { type: "text", text: String(ctx.promoDescripcion || "") },
        ],
      },
    ],
    getFallbackText: (ctx) =>
      `¡Hola ${ctx.clienteNombre}!\n\n*${ctx.promoTitulo}*\n${ctx.promoDescripcion}\n\n¡No dudes en consultarnos!\n\n${ctx.organizationName}`,
  },

  ENCUESTA_SATISFACCION: {
    templateName: "encuesta_satisfaccion",
    getComponents: (ctx) => [
      {
        type: "body",
        parameters: [
          { type: "text", text: String(ctx.clienteNombre || "") },
          { type: "text", text: String(ctx.dispositivo || "") },
        ],
      },
    ],
    getFallbackText: (ctx) =>
      `¡Hola ${ctx.clienteNombre}! Queremos saber cómo fue tu experiencia${ctx.dispositivo ? ` con tu ${ctx.dispositivo}` : ""}. Del 1 al 5, ¿qué tan satisfecho/a estás?\n\n${ctx.organizationName}`,
  },

  FELICITACION: {
    templateName: "felicitacion",
    getComponents: (ctx) => [
      {
        type: "body",
        parameters: [
          { type: "text", text: String(ctx.clienteNombre || "") },
          { type: "text", text: String(ctx.organizationName || "") },
        ],
      },
    ],
    getFallbackText: (ctx) =>
      `¡Hola ${ctx.clienteNombre}! ¡Desde ${ctx.organizationName} queremos desearte un muy feliz día! Tenés un descuento especial en tu próximo servicio.\n\n${ctx.organizationName}`,
  },

  // --- Operativo avanzado ---

  SOLICITUD_INFO: {
    templateName: "solicitud_info",
    getComponents: (ctx) => [
      {
        type: "body",
        parameters: [
          { type: "text", text: String(ctx.clienteNombre || "") },
          { type: "text", text: String(ctx.dispositivo || "") },
          { type: "text", text: String(ctx.numeroOrden || "") },
        ],
      },
    ],
    getFallbackText: (ctx) =>
      `¡Hola ${ctx.clienteNombre}! Nos comunicamos por tu ${ctx.dispositivo} (Orden #${ctx.numeroOrden}). Necesitamos información adicional para continuar con el servicio.\n\n${ctx.organizationName}`,
  },

  REPUESTO_DISPONIBLE: {
    templateName: "repuesto_disponible",
    getComponents: (ctx) => [
      {
        type: "body",
        parameters: [
          { type: "text", text: String(ctx.clienteNombre || "") },
          { type: "text", text: String(ctx.repuestoNombre || "necesario") },
          { type: "text", text: String(ctx.dispositivo || "") },
          { type: "text", text: String(ctx.numeroOrden || "") },
        ],
      },
    ],
    getFallbackText: (ctx) =>
      `¡Hola ${ctx.clienteNombre}! El repuesto *${ctx.repuestoNombre || "necesario"}* para tu ${ctx.dispositivo} ya está disponible. Retomamos la reparación de inmediato (Orden #${ctx.numeroOrden}).\n\n${ctx.organizationName}`,
  },

  REPUESTO_NO_DISPONIBLE: {
    templateName: "repuesto_no_disponible",
    getComponents: (ctx) => [
      {
        type: "body",
        parameters: [
          { type: "text", text: String(ctx.clienteNombre || "") },
          { type: "text", text: String(ctx.repuestoNombre || "necesario") },
          { type: "text", text: String(ctx.dispositivo || "") },
          { type: "text", text: String(ctx.numeroOrden || "") },
        ],
      },
    ],
    getFallbackText: (ctx) =>
      `¡Hola ${ctx.clienteNombre}! Lamentablemente el repuesto *${ctx.repuestoNombre || "necesario"}* para tu ${ctx.dispositivo} no está disponible. Contactanos para evaluar alternativas (Orden #${ctx.numeroOrden}).\n\n${ctx.organizationName}`,
  },

  AVISO_DEMORA: {
    templateName: "aviso_demora",
    getComponents: (ctx) => [
      {
        type: "body",
        parameters: [
          { type: "text", text: String(ctx.clienteNombre || "") },
          { type: "text", text: String(ctx.dispositivo || "") },
          { type: "text", text: String(ctx.numeroOrden || "") },
          { type: "text", text: String(ctx.motivoDemora || "") },
        ],
      },
    ],
    getFallbackText: (ctx) =>
      `¡Hola ${ctx.clienteNombre}! La reparación de tu ${ctx.dispositivo} (Orden #${ctx.numeroOrden}) está tomando más tiempo del estimado${ctx.motivoDemora ? `. Motivo: ${ctx.motivoDemora}` : ""}. Pedimos disculpas.\n\n${ctx.organizationName}`,
  },

  REINGRESO_GARANTIA: {
    templateName: "reingreso_garantia",
    getComponents: (ctx) => [
      {
        type: "body",
        parameters: [
          { type: "text", text: String(ctx.clienteNombre || "") },
          { type: "text", text: String(ctx.dispositivo || "") },
          { type: "text", text: String(ctx.numeroOrden || "") },
        ],
      },
    ],
    // numeroOrden es la orden NUEVA (la del re-ingreso): el aviso sale al aceptar el reclamo.
    getFallbackText: (ctx) =>
      `¡Hola ${ctx.clienteNombre}! Aceptamos tu reclamo de garantía: tu ${ctx.dispositivo} reingresó y lo revisamos sin costo (orden de re-ingreso #${ctx.numeroOrden}).\n\n${ctx.organizationName}`,
  },

  GARANTIA_POR_VENCER: {
    templateName: "garantia_por_vencer",
    getComponents: (ctx) => [
      {
        type: "body",
        parameters: [
          { type: "text", text: String(ctx.clienteNombre || "") },
          { type: "text", text: String(ctx.garantiaDetalle || "") },
          { type: "text", text: String(ctx.fechaVencimiento || "") },
        ],
      },
    ],
    getFallbackText: (ctx) =>
      `¡Hola ${ctx.clienteNombre}! La garantía de ${ctx.garantiaDetalle} vence el ${ctx.fechaVencimiento}. Si notás alguna falla, acercate antes de esa fecha para que lo revisemos sin cargo.\n\n${ctx.organizationName}`,
  },

  // --- Recuperación ---

  CLIENTE_INACTIVO: {
    templateName: "cliente_inactivo",
    getComponents: (ctx) => [
      {
        type: "body",
        parameters: [
          { type: "text", text: String(ctx.clienteNombre || "") },
          { type: "text", text: String(ctx.organizationName || "") },
        ],
      },
    ],
    getFallbackText: (ctx) =>
      `¡Hola ${ctx.clienteNombre}! Hace tiempo que no nos visitás. En ${ctx.organizationName} seguimos a tu disposición. ¡Ofrecemos diagnóstico sin cargo!\n\n${ctx.organizationName}`,
  },

  SEGUIMIENTO_PRESUPUESTO_RECHAZADO: {
    templateName: "seguimiento_presupuesto_rechazado",
    getComponents: (ctx) => [
      {
        type: "body",
        parameters: [
          { type: "text", text: String(ctx.clienteNombre || "") },
          { type: "text", text: String(ctx.dispositivo || "") },
          { type: "text", text: String(ctx.numeroOrden || "") },
        ],
      },
    ],
    getFallbackText: (ctx) =>
      `¡Hola ${ctx.clienteNombre}! Nos comunicamos por tu ${ctx.dispositivo} (Orden #${ctx.numeroOrden}). Podemos evaluar alternativas para resolver el problema. Respondenos si querés que revisemos otras opciones.\n\n${ctx.organizationName}`,
  },
}

const estadoLabels: Record<string, string> = {
  RECIBIDO: "Recibido",
  EN_DIAGNOSTICO: "En diagnóstico",
  PRESUPUESTADO: "Presupuestado",
  APROBADO: "Aprobado",
  EN_REPARACION: "En reparación",
  ESPERANDO_REPUESTO: "Esperando repuesto",
  REPARADO: "Listo para retirar",
  ENTREGADO: "Entregado",
  ENTREGADO_SIN_REPARACION: "Retirado sin reparación",
  CANCELADO: "Cancelado",
  SIN_REPARACION: "Sin reparación",
  SIN_FALLA_DETECTADA: "Sin falla detectada",
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
