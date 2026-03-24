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
      `Hola! Su orden #${ctx.numeroOrden} (${ctx.dispositivo}) cambió a: *${getEstadoLabel(String(ctx.estado || ""))}*.${
        ctx.estado === "REPARADO"
          ? "\n\nSu equipo está listo para retirar!"
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
      `Hola! El presupuesto para su orden #${ctx.numeroOrden} (${ctx.dispositivo}) es de *${formatPrice(ctx.presupuesto as number, ctx.moneda as string)}*.\n\nResponda *SI* para aprobar o *NO* para rechazar.\n\n${ctx.organizationName}`,
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
      `Hola! Su reparación tiene *${ctx.diasValidez} días de garantía* (hasta ${ctx.fechaVencimiento}).\n\nConserve este mensaje como comprobante.\n\n${ctx.organizationName}`,
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
      `Hola! Su ${ctx.dispositivo} (Orden #${ctx.numeroOrden}) está listo para retirar.\n\nPuede pasar a retirarlo en horario de atencion.\n\n${ctx.organizationName}`,
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
      `Hola ${ctx.clienteNombre}! Bienvenido/a a ${ctx.organizationName}. Gracias por confiar en nosotros. Puede contactarnos por este medio para cualquier consulta.\n\n${ctx.organizationName}`,
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
      `Hola ${ctx.clienteNombre}! Gracias por su consulta. Si desea traer su equipo para una revision sin cargo, estamos a su disposicion.\n\n${ctx.organizationName}`,
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
      `Hola ${ctx.clienteNombre}! Le recordamos que tiene un saldo pendiente de *${formatPrice(ctx.saldoPendiente as number, ctx.moneda as string)}*${ctx.numeroOrden ? ` (Orden #${ctx.numeroOrden})` : ""}.\n\n${ctx.organizationName}`,
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
      `Hola ${ctx.clienteNombre}! Confirmamos la recepcion de su pago por *${formatPrice(ctx.montoPago as number, ctx.moneda as string)}*. Gracias!\n\n${ctx.organizationName}`,
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
      `Hola ${ctx.clienteNombre}! Le enviamos el link para realizar el pago de *${formatPrice(ctx.montoPago as number, ctx.moneda as string)}*:\n\n${ctx.linkPago}\n\n${ctx.organizationName}`,
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
      `Hola ${ctx.clienteNombre}! Desde ${ctx.organizationName} le recordamos que es buen momento para un chequeo preventivo de su equipo. Consulte por turno!\n\n${ctx.organizationName}`,
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
      `Hola ${ctx.clienteNombre}!\n\n*${ctx.promoTitulo}*\n${ctx.promoDescripcion}\n\nNo dude en consultarnos!\n\n${ctx.organizationName}`,
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
      `Hola ${ctx.clienteNombre}! Queremos saber como fue su experiencia${ctx.dispositivo ? ` con su ${ctx.dispositivo}` : ""}. Del 1 al 5, que tan satisfecho esta?\n\n${ctx.organizationName}`,
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
      `Hola ${ctx.clienteNombre}! Desde ${ctx.organizationName} queremos desearle un muy feliz dia! Tiene un descuento especial en su proximo servicio.\n\n${ctx.organizationName}`,
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
      `Hola ${ctx.clienteNombre}! Nos comunicamos por su ${ctx.dispositivo} (Orden #${ctx.numeroOrden}). Necesitamos informacion adicional para continuar con el servicio.\n\n${ctx.organizationName}`,
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
      `Hola ${ctx.clienteNombre}! El repuesto *${ctx.repuestoNombre || "necesario"}* para su ${ctx.dispositivo} ya esta disponible. Retomamos la reparacion de inmediato (Orden #${ctx.numeroOrden}).\n\n${ctx.organizationName}`,
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
      `Hola ${ctx.clienteNombre}! Lamentablemente el repuesto *${ctx.repuestoNombre || "necesario"}* para su ${ctx.dispositivo} no esta disponible. Contactenos para evaluar alternativas (Orden #${ctx.numeroOrden}).\n\n${ctx.organizationName}`,
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
      `Hola ${ctx.clienteNombre}! La reparacion de su ${ctx.dispositivo} (Orden #${ctx.numeroOrden}) esta tomando mas tiempo del estimado${ctx.motivoDemora ? `. Motivo: ${ctx.motivoDemora}` : ""}. Pedimos disculpas.\n\n${ctx.organizationName}`,
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
    getFallbackText: (ctx) =>
      `Hola ${ctx.clienteNombre}! Su ${ctx.dispositivo} esta cubierto por garantia. Puede traerlo para revision sin costo adicional (Orden #${ctx.numeroOrden}).\n\n${ctx.organizationName}`,
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
      `Hola ${ctx.clienteNombre}! Hace tiempo que no nos visita. En ${ctx.organizationName} seguimos a su disposicion. Ofrecemos diagnostico sin cargo!\n\n${ctx.organizationName}`,
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
      `Hola ${ctx.clienteNombre}! Nos comunicamos por su ${ctx.dispositivo} (Orden #${ctx.numeroOrden}). Podemos evaluar alternativas para resolver el problema. Respondanos si desea que revisemos otras opciones.\n\n${ctx.organizationName}`,
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
