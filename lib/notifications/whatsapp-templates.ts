import { formatCurrencyValue, type CurrencyCode, DEFAULT_CURRENCY } from "@/lib/currency"
import { formatDateValue } from "@/lib/timezone"
import { formatPhoneForCountry } from "@/lib/countries"
import { EstadoOrden, NotificationContext, MetodoPagoVenta } from "./types"
import { renderTemplate, getPlantilla } from "@/lib/whatsapp/plantillas-catalog"
import { resolveTerminologia, t } from "@/lib/terminologia"

export interface WhatsAppTemplate {
  id: string
  nombre: string
  mensaje: string
}

/**
 * Mapeo de IDs legacy (usados por la UI del diálogo) a las keys del catálogo
 * de plantillas configurables. Si la organización tiene una plantilla custom
 * en plantillas_whatsapp[<catalogKey>], se usa esa en lugar del default.
 */
const LEGACY_ID_TO_CATALOG_KEY: Record<string, string> = {
  estado_actual: "orden_estado_actual",
  presupuesto: "orden_presupuesto",
  listo_retirar: "orden_listo_retirar",
  entrega_completada: "orden_entrega_completada",
  seguimiento: "orden_seguimiento",
  solicitud_info: "orden_solicitud_info",
  repuesto_disponible: "orden_repuesto_disponible",
  repuesto_no_disponible: "orden_repuesto_no_disponible",
  aviso_demora: "orden_aviso_demora",
  seguimiento_presupuesto_rechazado: "orden_seguimiento_rechazado",
  garantia: "garantia_creada",
  reingreso_garantia: "garantia_reingreso",
  venta_confirmacion: "venta_comprobante",
  venta_garantia: "venta_garantias",
  venta_agradecimiento: "venta_agradecimiento",
  recordatorio_pago: "cobranza_recordatorio_pago",
  confirmacion_pago: "cobranza_confirmacion_pago",
  link_pago: "cobranza_link_pago",
  bienvenida_cliente: "bienvenida_cliente",
  respuesta_consulta: "respuesta_consulta",
  mantenimiento_preventivo: "mantenimiento_preventivo",
  promocion: "promocion",
  encuesta_satisfaccion: "encuesta_satisfaccion",
  felicitacion: "felicitacion",
  cliente_inactivo: "cliente_inactivo",
}

function buildVarsFromContext(ctx: NotificationContext): Record<string, string | number> {
  const formatCurrency = (amount: number | null | undefined) =>
    formatCurrencyValue(amount ?? 0, (ctx.moneda as CurrencyCode) || DEFAULT_CURRENCY)
  const formatDate = (date: Date | null | undefined) =>
    date ? formatDateValue(date, ctx.zonaHoraria) : ""

  const links = ctx.orden ? getOrdenLinks(ctx) : null

  const vars: Record<string, string | number> = {
    cliente: ctx.cliente.nombre || "",
    empresa: ctx.organizationName || "",
    fecha: formatDate(new Date()),
  }

  if (ctx.orden) {
    vars.numero_orden = ctx.orden.numeroOrden
    vars.dispositivo = ctx.orden.dispositivo || ""
    vars.estado = estadoLabels[ctx.orden.estado] || ""
    vars.presupuesto = ctx.orden.presupuesto ? formatCurrency(ctx.orden.presupuesto) : ""
    vars.link_seguimiento = links?.trackingUrl || ""
    vars.link_pdf = links?.pdfUrl || ""
    vars.linea_orden = `\n\nOrden #${ctx.orden.numeroOrden}`
  }

  if (ctx.garantia) {
    vars.garantia_dias = ctx.garantia.diasValidez
    vars.garantia_fecha = formatDate(ctx.garantia.fechaVencimiento)
  }

  if (ctx.pago) {
    vars.monto_pago = ctx.pago.monto ? formatCurrency(ctx.pago.monto) : ""
    vars.saldo = ctx.pago.saldoPendiente ? formatCurrency(ctx.pago.saldoPendiente) : "Al día"
    vars.link_pago = ctx.pago.linkPago || ""
    vars.saldo_fiado = ctx.pago.desglose && ctx.pago.desglose.fiado > 0 ? formatCurrency(ctx.pago.desglose.fiado) : ""
    vars.saldo_ordenes = ctx.pago.desglose && ctx.pago.desglose.ordenes > 0 ? formatCurrency(ctx.pago.desglose.ordenes) : ""
    vars.linea_desglose_pago = ctx.pago.desglose ? buildDesgloseLines(ctx.pago.desglose, formatCurrency) : ""
  }

  if (ctx.repuesto) {
    vars.repuesto = ctx.repuesto.nombre || "necesario"
  }

  if (ctx.demora) {
    vars.motivo_demora = ctx.demora.motivo || ""
  }

  if (ctx.promocion) {
    vars.promo_titulo = ctx.promocion.titulo || ""
    vars.promo_descripcion = ctx.promocion.descripcion || ""
  }

  if (ctx.venta) {
    vars.numero_venta = String(ctx.venta.numeroVenta).padStart(4, "0")
    vars.total = formatCurrency(ctx.venta.total)
    vars.metodo_pago = metodoPagoLabels[ctx.venta.metodoPago] || ctx.venta.metodoPago
    vars.items = ctx.venta.items
      .map((i) => `- ${i.descripcion} x${i.cantidad}`)
      .join("\n")
    vars.garantias = ctx.venta.garantias.length
      ? ctx.venta.garantias
          .map((g) => `- Garantía #${g.numeroGarantia} (${g.diasValidez} días)`)
          .join("\n")
      : ""
  }

  return vars
}

/**
 * Arma las lineas de desglose de deuda (cuenta corriente + ordenes) para el
 * recordatorio de pago. Solo incluye el componente que sea > 0.
 */
function buildDesgloseLines(
  desglose: { fiado: number; ordenes: number },
  formatCurrency: (amount: number) => string,
): string {
  const lines: string[] = []
  if (desglose.fiado > 0) lines.push(`Cuenta corriente: ${formatCurrency(desglose.fiado)}`)
  if (desglose.ordenes > 0) lines.push(`Órdenes pendientes: ${formatCurrency(desglose.ordenes)}`)
  return lines.length ? `\n${lines.join("\n")}` : ""
}

/**
 * Aplica el override del usuario (si existe) reemplazando el mensaje generado.
 * Priority: org override > catalog defaultText > legacy generator (fallback).
 */
function applyOverride(
  legacyId: string,
  defaultMessage: string,
  ctx: NotificationContext,
  plantillasOverride?: Record<string, string> | null,
): string {
  const vars = buildVarsFromContext(ctx)

  const keys: string[] = []
  if (legacyId === "estado_actual" && ctx.orden?.estado) {
    keys.push(`orden_estado_${ctx.orden.estado.toLowerCase()}`)
  }
  const catalogKey = LEGACY_ID_TO_CATALOG_KEY[legacyId]
  if (catalogKey) keys.push(catalogKey)

  // 1) Override de la org
  if (plantillasOverride) {
    for (const key of keys) {
      const o = plantillasOverride[key]
      if (o && o.trim()) return renderTemplate(o, vars)
    }
  }
  // 2) Default del catálogo (única fuente de verdad)
  for (const key of keys) {
    const def = getPlantilla(key)?.defaultText
    if (def && def.trim()) return renderTemplate(def, vars)
  }
  // 3) Fallback: generador propio (legacyIds sin entrada en catálogo)
  return defaultMessage
}

const estadoLabels: Record<EstadoOrden, string> = {
  RECIBIDO: "recibido",
  EN_DIAGNOSTICO: "en diagnostico",
  PRESUPUESTADO: "presupuestado - esperando su respuesta",
  APROBADO: "aprobado - en cola de reparacion",
  EN_REPARACION: "en reparacion",
  ESPERANDO_REPUESTO: "esperando repuesto",
  REPARADO: "listo para retirar",
  ENTREGADO: "entregado",
  ENTREGADO_SIN_REPARACION: "retirado sin reparacion",
  ENTREGADO_SIN_COBRO: "entregado sin cobro",
  CANCELADO: "cancelado",
  SIN_REPARACION: "sin posibilidad de reparacion",
  SIN_FALLA_DETECTADA: "sin falla detectada",
}

export function getWhatsAppTemplates(
  ctx: NotificationContext,
  plantillasOverride?: Record<string, string> | null,
): WhatsAppTemplate[] {
  const templates: WhatsAppTemplate[] = []
  const ov = (id: string, msg: string) => applyOverride(id, msg, ctx, plantillasOverride)

  if (ctx.orden) {
    // Plantilla de estado actual
    templates.push({
      id: "estado_actual",
      nombre: `Estado: ${estadoLabels[ctx.orden.estado]}`,
      mensaje: ov("estado_actual", generateEstadoMessage(ctx)),
    })

    // Plantilla de presupuesto (si existe)
    if (ctx.orden.presupuesto) {
      templates.push({
        id: "presupuesto",
        nombre: "Informar presupuesto",
        mensaje: ov("presupuesto", generatePresupuestoMessage(ctx)),
      })
    }

    // Plantilla de listo para retirar
    if (ctx.orden.estado === "REPARADO") {
      templates.push({
        id: "listo_retirar",
        nombre: "Recordatorio de retiro",
        mensaje: ov("listo_retirar", generateRecordatorioMessage(ctx)),
      })
    }

    // Plantilla de entrega completada con comprobante
    if (ctx.orden.estado === "ENTREGADO" || ctx.orden.estado === "ENTREGADO_SIN_REPARACION") {
      templates.push({
        id: "entrega_completada",
        nombre: ctx.orden.estado === "ENTREGADO_SIN_REPARACION" ? "Comprobante de retiro" : "Comprobante de entrega",
        mensaje: ov("entrega_completada", generateEntregaCompletadaMessage(ctx)),
      })
    }

    // Plantilla generica de seguimiento
    templates.push({
      id: "seguimiento",
      nombre: "Mensaje de seguimiento",
      mensaje: ov("seguimiento", generateSeguimientoMessage(ctx)),
    })
  }

  if (ctx.garantia) {
    templates.push({
      id: "garantia",
      nombre: "Informar garantia",
      mensaje: ov("garantia", generateGarantiaMessage(ctx)),
    })
  }

  // === Plantillas de pre-venta y captación (solo sin orden activa) ===
  if (!ctx.orden) {
    templates.push({
      id: "bienvenida_cliente",
      nombre: "Bienvenida nuevo cliente",
      mensaje: ov("bienvenida_cliente", generateBienvenidaMessage(ctx)),
    })

    templates.push({
      id: "respuesta_consulta",
      nombre: "Respuesta a consulta",
      mensaje: ov("respuesta_consulta", generateRespuestaConsultaMessage(ctx)),
    })
  }

  // === Plantillas de cobranza y pagos ===
  if (ctx.pago) {
    if (ctx.pago.saldoPendiente && ctx.pago.saldoPendiente > 0) {
      templates.push({
        id: "recordatorio_pago",
        nombre: "Recordatorio de pago",
        mensaje: ov("recordatorio_pago", generateRecordatorioPagoMessage(ctx)),
      })
    }

    // Solo se ofrece cuando hay una señal explícita de pago recibido
    // (fechaPago o metodoPago). ctx.pago también se popula con saldo
    // pendiente sin pago (ver orden-detail.tsx / cliente-whatsapp-dialog.tsx),
    // y en ese caso no corresponde ofrecer "confirmamos la recepción de su pago".
    if (ctx.pago.fechaPago || ctx.pago.metodoPago) {
      templates.push({
        id: "confirmacion_pago",
        nombre: "Confirmacion de pago",
        mensaje: ov("confirmacion_pago", generateConfirmacionPagoMessage(ctx)),
      })
    }

    if (ctx.pago.linkPago) {
      templates.push({
        id: "link_pago",
        nombre: "Enviar link de pago",
        mensaje: ov("link_pago", generateLinkPagoMessage(ctx)),
      })
    }
  }

  // === Plantillas de retención y fidelización (solo sin orden activa) ===
  if (!ctx.orden) {
    templates.push({
      id: "mantenimiento_preventivo",
      nombre: "Recordatorio mantenimiento",
      mensaje: ov("mantenimiento_preventivo", generateMantenimientoMessage(ctx)),
    })

    if (ctx.promocion) {
      templates.push({
        id: "promocion",
        nombre: "Promocion / Oferta",
        mensaje: ov("promocion", generatePromocionMessage(ctx)),
      })
    }

    templates.push({
      id: "felicitacion",
      nombre: "Felicitacion",
      mensaje: ov("felicitacion", generateFelicitacionMessage(ctx)),
    })

    templates.push({
      id: "cliente_inactivo",
      nombre: "Cliente inactivo",
      mensaje: ov("cliente_inactivo", generateClienteInactivoMessage(ctx)),
    })
  }

  // Encuesta: disponible post-entrega o sin orden (envio manual)
  if (!ctx.orden || ctx.orden.estado === "ENTREGADO") {
    templates.push({
      id: "encuesta_satisfaccion",
      nombre: "Encuesta de satisfaccion",
      mensaje: ov("encuesta_satisfaccion", generateEncuestaMessage(ctx)),
    })
  }

  // === Plantillas operativo avanzado ===
  if (ctx.orden) {
    templates.push({
      id: "solicitud_info",
      nombre: "Solicitar informacion",
      mensaje: ov("solicitud_info", generateSolicitudInfoMessage(ctx)),
    })

    // Repuesto: disponible en ESPERANDO_REPUESTO o si acaba de cambiar desde ese estado
    if (ctx.repuesto && (ctx.orden.estado === "ESPERANDO_REPUESTO" || ctx.orden.estadoAnterior === "ESPERANDO_REPUESTO")) {
      if (ctx.repuesto.disponible) {
        templates.push({
          id: "repuesto_disponible",
          nombre: "Repuesto disponible",
          mensaje: ov("repuesto_disponible", generateRepuestoDisponibleMessage(ctx)),
        })
      } else {
        templates.push({
          id: "repuesto_no_disponible",
          nombre: "Repuesto no disponible",
          mensaje: ov("repuesto_no_disponible", generateRepuestoNoDisponibleMessage(ctx)),
        })
      }
    }

    if (ctx.demora) {
      templates.push({
        id: "aviso_demora",
        nombre: "Aviso de demora",
        mensaje: ov("aviso_demora", generateAvisoDemoraMessage(ctx)),
      })
    }

    if (ctx.garantia) {
      templates.push({
        id: "reingreso_garantia",
        nombre: "Re-ingreso por garantia",
        mensaje: ov("reingreso_garantia", generateReingresoGarantiaMessage(ctx)),
      })
    }

    // Seguimiento presupuesto rechazado: cuando cancelaron desde presupuestado
    if (ctx.orden.estado === "CANCELADO" && ctx.orden.estadoAnterior === "PRESUPUESTADO") {
      templates.push({
        id: "seguimiento_presupuesto_rechazado",
        nombre: "Seguimiento presupuesto rechazado",
        mensaje: ov("seguimiento_presupuesto_rechazado", generateSeguimientoPresupuestoRechazadoMessage(ctx)),
      })
    }
  }

  // Plantillas para ventas
  if (ctx.venta) {
    templates.push({
      id: "venta_confirmacion",
      nombre: "Confirmacion de compra",
      mensaje: ov("venta_confirmacion", generateVentaConfirmacionMessage(ctx)),
    })

    // Si tiene garantías
    if (ctx.venta.garantias.length > 0) {
      templates.push({
        id: "venta_garantia",
        nombre: "Informar garantias",
        mensaje: ov("venta_garantia", generateVentaGarantiaMessage(ctx)),
      })
    }

    templates.push({
      id: "venta_agradecimiento",
      nombre: "Agradecimiento",
      mensaje: ov("venta_agradecimiento", generateVentaAgradecimientoMessage(ctx)),
    })
  }

  return templates
}

function generateEstadoMessage(ctx: NotificationContext): string {
  const estado = ctx.orden!.estado
  const label = estadoLabels[estado]
  const term = resolveTerminologia(ctx.terminologia ?? null)
  const tEquipo = t(term, "equipo")
  const tOrden = t(term, "orden")
  const tReparacion = t(term, "reparacion")

  let mensaje = `Hola ${ctx.cliente.nombre}, le informamos que su ${ctx.orden!.dispositivo} (${tOrden} #${ctx.orden!.numeroOrden}) se encuentra ${label}.`

  switch (estado) {
    case "RECIBIDO":
      mensaje += `\n\nRecibimos su ${tEquipo} y ya esta en cola de diagnostico. Le avisaremos apenas tengamos novedades.`
      break
    case "EN_DIAGNOSTICO":
      mensaje += `\n\nEstamos revisando su ${tEquipo} para detectar la falla. En breve le enviamos el presupuesto.`
      break
    case "PRESUPUESTADO":
      mensaje += "\n\nPara avanzar, *apruebe o rechace el presupuesto* desde el link de seguimiento de abajo. Cualquier duda, escribanos."
      break
    case "APROBADO":
      mensaje += `\n\nGracias por aprobar el presupuesto! Su ${tEquipo} entra en cola de ${tReparacion.toLowerCase()}. Le avisamos cuando este listo.`
      break
    case "EN_REPARACION":
      mensaje += `\n\nYa estamos trabajando en su ${tEquipo}. Le avisamos en cuanto este terminado.`
      break
    case "ESPERANDO_REPUESTO":
      mensaje += `\n\nSu ${tReparacion.toLowerCase()} esta en pausa esperando un repuesto. Apenas llegue, retomamos y le avisamos.`
      break
    case "REPARADO":
      mensaje += `\n\nSu ${tEquipo} esta listo y *listo para retirar*. Lo esperamos en horario de atencion. Comprobante en el link.`
      break
    case "ENTREGADO":
      mensaje += `\n\nSu ${tEquipo} fue entregado. Gracias por confiar en nosotros! Si necesita algo mas, escribanos.`
      break
    case "ENTREGADO_SIN_REPARACION":
      mensaje += `\n\nSu ${tEquipo} fue retirado sin ${tReparacion.toLowerCase()}. Gracias por consultarnos; quedamos a disposicion.`
      break
    case "CANCELADO":
      mensaje += `\n\nLa ${tOrden.toLowerCase()} fue cancelada. Si desea retomar o ingresar un nuevo servicio, escribanos.`
      break
    case "SIN_REPARACION":
      mensaje += `\n\nNo fue posible completar la ${tReparacion.toLowerCase()} de su ${tEquipo}. Puede pasar a retirarlo en horario de atencion. Quedamos a disposicion.`
      break
    case "SIN_FALLA_DETECTADA":
      mensaje += `\n\nRevisamos su ${tEquipo} y no detectamos la falla reportada. Puede pasar a retirarlo en horario de atencion. Quedamos a disposicion.`
      break
  }

  mensaje += appendOrdenLinks(getOrdenLinks(ctx))
  mensaje += `\n\n${ctx.organizationName}`

  return mensaje
}

function generatePresupuestoMessage(ctx: NotificationContext): string {
  const formatCurrency = (amount: number) =>
    formatCurrencyValue(amount, (ctx.moneda as CurrencyCode) || DEFAULT_CURRENCY)

  const links = getOrdenLinks(ctx)
  const term = resolveTerminologia(ctx.terminologia ?? null)
  const tReparacion = t(term, "reparacion").toLowerCase()
  const tOrden = t(term, "orden")

  return `Hola ${ctx.cliente.nombre}, ya tenemos el presupuesto para la ${tReparacion} de su ${ctx.orden!.dispositivo}:

*Presupuesto: ${formatCurrency(ctx.orden!.presupuesto || 0)}*

${tOrden} #${ctx.orden!.numeroOrden}

Para avanzar, *apruebe o rechace el presupuesto* desde el link de abajo.${appendOrdenLinks(links)}

${ctx.organizationName}`
}

function generateGarantiaMessage(ctx: NotificationContext): string {
  const formatDate = (date: Date) => formatDateValue(date, ctx.zonaHoraria)
  const term = resolveTerminologia(ctx.terminologia ?? null)
  const tReparacion = t(term, "reparacion").toLowerCase()
  const tOrden = t(term, "orden")
  const tEquipo = t(term, "equipo")

  let mensaje = `Hola ${ctx.cliente.nombre}, su ${tReparacion} ahora cuenta con garantia:

*${ctx.garantia!.diasValidez} dias de garantia*
Valida hasta: ${formatDate(ctx.garantia!.fechaVencimiento)}`

  if (ctx.orden) {
    mensaje += `\n\n${tOrden} #${ctx.orden.numeroOrden}\n${tEquipo}: ${ctx.orden.dispositivo}`
    mensaje += appendOrdenLinks(getOrdenLinks(ctx))
  }

  mensaje += `\n\nConserve este mensaje como comprobante.\n\n${ctx.organizationName}`

  return mensaje
}

function generateRecordatorioMessage(ctx: NotificationContext): string {
  const links = getOrdenLinks(ctx)
  const term = resolveTerminologia(ctx.terminologia ?? null)
  const tOrden = t(term, "orden")

  return `Hola ${ctx.cliente.nombre}, le recordamos que su ${ctx.orden!.dispositivo} esta listo para retirar.

${tOrden} #${ctx.orden!.numeroOrden}

Puede pasar por nuestro local en horario de atencion. Lo esperamos!${appendOrdenLinks(links)}

${ctx.organizationName}`
}

function generateSeguimientoMessage(ctx: NotificationContext): string {
  const links = getOrdenLinks(ctx)
  const term = resolveTerminologia(ctx.terminologia ?? null)
  const tOrden = t(term, "orden")

  return `Hola ${ctx.cliente.nombre}, nos comunicamos por su ${ctx.orden!.dispositivo} (${tOrden} #${ctx.orden!.numeroOrden}).

[Escriba su mensaje aqui]${appendOrdenLinks(links)}

${ctx.organizationName}`
}

function generateEntregaCompletadaMessage(ctx: NotificationContext): string {
  const links = getOrdenLinks(ctx)
  const esRetiro = ctx.orden!.estado === "ENTREGADO_SIN_REPARACION"

  if (esRetiro) {
    return `Hola ${ctx.cliente.nombre}, confirmamos el retiro de su ${ctx.orden!.dispositivo} sin reparacion.

*Orden #${ctx.orden!.numeroOrden} - RETIRADO SIN REPARACION*${links ? `\n\nDescargar comprobante:\n${links.pdfUrl}\n\nSeguimiento: ${links.trackingUrl}` : ""}

Gracias por habernos consultado.

${ctx.organizationName}`
  }

  return `Hola ${ctx.cliente.nombre}, confirmamos la entrega de su ${ctx.orden!.dispositivo}.

*Orden #${ctx.orden!.numeroOrden} - ENTREGADO*${links ? `\n\nDescargar comprobante:\n${links.pdfUrl}\n\nSeguimiento: ${links.trackingUrl}` : ""}

Gracias por confiar en nosotros!

${ctx.organizationName}`
}

// Funciones para plantillas de ventas
const metodoPagoLabels: Record<MetodoPagoVenta, string> = {
  EFECTIVO: "efectivo",
  TRANSFERENCIA: "transferencia",
  TARJETA: "tarjeta",
  TARJETA_DEBITO: "tarjeta de débito",
  TARJETA_CREDITO: "tarjeta de crédito",
  MERCADOPAGO: "MercadoPago",
  CUENTA_CORRIENTE: "cuenta corriente",
  OTRO: "otro medio",
}

function getBaseUrl(ctx: NotificationContext): string {
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"
  if (ctx.organizationSlug) {
    return `https://${ctx.organizationSlug}.${rootDomain}`
  }
  return `https://${rootDomain}`
}

function getOrdenLinks(ctx: NotificationContext): { trackingUrl: string; pdfUrl: string } | null {
  if (!ctx.orden?.publicToken) return null
  const baseUrl = getBaseUrl(ctx)
  return {
    trackingUrl: `${baseUrl}/seguimiento/${ctx.orden.publicToken}`,
    pdfUrl: `${baseUrl}/api/public/ordenes/${ctx.orden.publicToken}/pdf`,
  }
}

function appendOrdenLinks(links: { trackingUrl: string; pdfUrl: string } | null): string {
  if (!links) return ""
  return `\n\nSeguimiento: ${links.trackingUrl}\nDescargar orden: ${links.pdfUrl}`
}

function generateVentaConfirmacionMessage(ctx: NotificationContext): string {
  const formatCurrency = (amount: number) =>
    formatCurrencyValue(amount, (ctx.moneda as CurrencyCode) || DEFAULT_CURRENCY)

  const venta = ctx.venta!
  const numeroVenta = `V${String(venta.numeroVenta).padStart(4, "0")}`
  const baseUrl = getBaseUrl(ctx)

  let productosTexto = venta.items
    .map((item) => `- ${item.descripcion} x${item.cantidad}`)
    .join("\n")

  const pdfUrl = `${baseUrl}/api/ventas/${venta.id}/pdf`

  return `Hola ${ctx.cliente.nombre}, gracias por su compra!

*Comprobante de Venta ${numeroVenta}*

Productos:
${productosTexto}

*Total: ${formatCurrency(venta.total)}*
Pago: ${metodoPagoLabels[venta.metodoPago]}

Descargar comprobante:
${pdfUrl}

${ctx.organizationName}`
}

function generateVentaGarantiaMessage(ctx: NotificationContext): string {
  const formatDate = (date: Date) => formatDateValue(date, ctx.zonaHoraria)
  const venta = ctx.venta!
  const numeroVenta = `V${String(venta.numeroVenta).padStart(4, "0")}`
  const baseUrl = getBaseUrl(ctx)

  let garantiasTexto = venta.garantias
    .map((g) => {
      const pdfUrl = `${baseUrl}/api/ventas/${venta.id}/garantia/${g.id}/pdf`
      return `*${g.numeroGarantia}*
${g.diasValidez} dias (hasta ${formatDate(g.fechaVencimiento)})
Descargar: ${pdfUrl}`
    })
    .join("\n\n")

  return `Hola ${ctx.cliente.nombre}, su compra (${numeroVenta}) incluye garantia:

${garantiasTexto}

Conserve estos certificados como comprobante.

${ctx.organizationName}`
}

function generateVentaAgradecimientoMessage(ctx: NotificationContext): string {
  return `Hola ${ctx.cliente.nombre}, gracias por elegirnos!

Esperamos que disfrute su compra. Si tiene alguna consulta, no dude en contactarnos.

Lo esperamos pronto!

${ctx.organizationName}`
}

// === Funciones generadoras para nuevas plantillas ===

function generateBienvenidaMessage(ctx: NotificationContext): string {
  return `Hola ${ctx.cliente.nombre}, bienvenido/a a ${ctx.organizationName}!

Gracias por confiar en nosotros. Somos especialistas en reparacion y servicio tecnico.

Puede contactarnos por este medio para cualquier consulta sobre nuestros servicios.

${ctx.organizationName}`
}

function generateRespuestaConsultaMessage(ctx: NotificationContext): string {
  return `Hola ${ctx.cliente.nombre}, gracias por su consulta.

[Detalle su respuesta aqui]

Si desea traer su equipo para una revision sin cargo, estamos a su disposicion.

${ctx.organizationName}`
}

// NOTE: unreachable in practice while "cobranza_recordatorio_pago" has a
// non-empty defaultText in the catalog — applyOverride resolves the catalog
// default before falling back to this generator (see applyOverride priority).
// Kept as the last-resort fallback for legacyIds without a catalog entry.
function generateRecordatorioPagoMessage(ctx: NotificationContext): string {
  const formatCurrency = (amount: number) =>
    formatCurrencyValue(amount, (ctx.moneda as CurrencyCode) || DEFAULT_CURRENCY)

  const saldo = ctx.pago?.saldoPendiente || 0
  let mensaje = `Hola ${ctx.cliente.nombre}, le recordamos que tiene un saldo pendiente de *${formatCurrency(saldo)}*.`

  if (ctx.pago?.desglose) {
    mensaje += buildDesgloseLines(ctx.pago.desglose, formatCurrency)
  }

  if (ctx.orden) {
    mensaje += `\n\nOrden #${ctx.orden.numeroOrden} - ${ctx.orden.dispositivo}`
    mensaje += appendOrdenLinks(getOrdenLinks(ctx))
  }

  mensaje += `\n\nPuede acercarse a nuestro local o consultarnos por medios de pago disponibles.`
  mensaje += `\n\n${ctx.organizationName}`

  return mensaje
}

function generateConfirmacionPagoMessage(ctx: NotificationContext): string {
  const formatCurrency = (amount: number) =>
    formatCurrencyValue(amount, (ctx.moneda as CurrencyCode) || DEFAULT_CURRENCY)

  let mensaje = `Hola ${ctx.cliente.nombre}, confirmamos la recepcion de su pago por *${formatCurrency(ctx.pago?.monto || 0)}*.`

  if (ctx.orden) {
    mensaje += `\n\nOrden #${ctx.orden.numeroOrden} - ${ctx.orden.dispositivo}`
    mensaje += appendOrdenLinks(getOrdenLinks(ctx))
  }

  if (ctx.pago?.saldoPendiente && ctx.pago.saldoPendiente > 0) {
    mensaje += `\nSaldo restante: ${formatCurrency(ctx.pago.saldoPendiente)}`
  } else {
    mensaje += `\n\nSu cuenta se encuentra al dia. Gracias!`
  }

  mensaje += `\n\n${ctx.organizationName}`

  return mensaje
}

function generateLinkPagoMessage(ctx: NotificationContext): string {
  const formatCurrency = (amount: number) =>
    formatCurrencyValue(amount, (ctx.moneda as CurrencyCode) || DEFAULT_CURRENCY)

  let mensaje = `Hola ${ctx.cliente.nombre}, le enviamos el link para realizar el pago:`

  if (ctx.pago?.monto) {
    mensaje += `\n\n*Monto: ${formatCurrency(ctx.pago.monto)}*`
  }

  mensaje += `\n\n${ctx.pago?.linkPago || "[Link de pago]"}`

  if (ctx.orden) {
    mensaje += `\n\nOrden #${ctx.orden.numeroOrden}`
    mensaje += appendOrdenLinks(getOrdenLinks(ctx))
  }

  mensaje += `\n\n${ctx.organizationName}`

  return mensaje
}

function generateMantenimientoMessage(ctx: NotificationContext): string {
  let mensaje = `Hola ${ctx.cliente.nombre}, desde ${ctx.organizationName} queremos recordarle que es buen momento para un chequeo preventivo de su equipo.`

  if (ctx.mantenimiento?.ultimoServicio) {
    const formatDate = (date: Date) => formatDateValue(date, ctx.zonaHoraria)
    mensaje += `\n\nSu ultimo servicio fue el ${formatDate(ctx.mantenimiento.ultimoServicio)}.`
  }

  if (ctx.mantenimiento?.tipoServicio) {
    mensaje += ` Servicio realizado: ${ctx.mantenimiento.tipoServicio}.`
  }

  mensaje += `\n\nEl mantenimiento preventivo ayuda a evitar fallas y prolongar la vida util de su equipo.`
  mensaje += `\n\nConsulte por turno disponible!`
  mensaje += `\n\n${ctx.organizationName}`

  return mensaje
}

function generatePromocionMessage(ctx: NotificationContext): string {
  const formatDate = (date: Date) => formatDateValue(date, ctx.zonaHoraria)

  let mensaje = `Hola ${ctx.cliente.nombre}!`
  mensaje += `\n\n*${ctx.promocion!.titulo}*`
  mensaje += `\n${ctx.promocion!.descripcion}`

  if (ctx.promocion!.descuento) {
    mensaje += `\n\n*${ctx.promocion!.descuento}*`
  }

  if (ctx.promocion!.validoHasta) {
    mensaje += `\nValido hasta: ${formatDate(ctx.promocion!.validoHasta)}`
  }

  mensaje += `\n\nNo dude en consultarnos!`
  mensaje += `\n\n${ctx.organizationName}`

  return mensaje
}

function generateEncuestaMessage(ctx: NotificationContext): string {
  let mensaje = `Hola ${ctx.cliente.nombre}, nos importa su opinion!`

  if (ctx.orden) {
    mensaje += `\n\nQueremos saber como fue su experiencia con la reparacion de su ${ctx.orden.dispositivo} (Orden #${ctx.orden.numeroOrden}).`
  } else {
    mensaje += `\n\nQueremos saber como fue su experiencia con nuestro servicio.`
  }

  mensaje += `\n\nDel 1 al 5, que tan satisfecho esta? (1 = Muy insatisfecho, 5 = Excelente)`

  if (ctx.encuestaUrl) {
    mensaje += `\n\nTambien puede completar nuestra encuesta aqui: ${ctx.encuestaUrl}`
  }

  mensaje += `\n\nSu opinion nos ayuda a mejorar. Gracias!`
  mensaje += `\n\n${ctx.organizationName}`

  return mensaje
}

function generateFelicitacionMessage(ctx: NotificationContext): string {
  return `Hola ${ctx.cliente.nombre}, desde ${ctx.organizationName} queremos desearle un muy feliz dia!

Gracias por ser parte de nuestra comunidad de clientes.

Como regalo, tiene un descuento especial en su proximo servicio. Consulte por mensaje!

${ctx.organizationName}`
}

function generateSolicitudInfoMessage(ctx: NotificationContext): string {
  let mensaje = `Hola ${ctx.cliente.nombre}, nos comunicamos por su ${ctx.orden!.dispositivo} (Orden #${ctx.orden!.numeroOrden}).`

  if (ctx.solicitudInfo) {
    mensaje += `\n\n${ctx.solicitudInfo}`
  } else {
    mensaje += `\n\nNecesitamos informacion adicional para continuar con el servicio.`
    mensaje += `\n\n[Detalle lo que necesita: fotos, contrasena, descripcion del problema, etc.]`
  }

  mensaje += appendOrdenLinks(getOrdenLinks(ctx))
  mensaje += `\n\nAgradecemos su pronta respuesta.`
  mensaje += `\n\n${ctx.organizationName}`

  return mensaje
}

function generateRepuestoDisponibleMessage(ctx: NotificationContext): string {
  const links = getOrdenLinks(ctx)

  return `Hola ${ctx.cliente.nombre}, buenas noticias!

El repuesto *${ctx.repuesto?.nombre || "necesario"}* para su ${ctx.orden!.dispositivo} ya esta disponible.

Orden #${ctx.orden!.numeroOrden}

Retomamos la reparacion de inmediato. Le avisaremos cuando este listo.${appendOrdenLinks(links)}

${ctx.organizationName}`
}

function generateRepuestoNoDisponibleMessage(ctx: NotificationContext): string {
  const links = getOrdenLinks(ctx)

  return `Hola ${ctx.cliente.nombre}, le informamos sobre su ${ctx.orden!.dispositivo} (Orden #${ctx.orden!.numeroOrden}).

Lamentablemente el repuesto *${ctx.repuesto?.nombre || "necesario"}* no se encuentra disponible o esta discontinuado.

Podemos ofrecerle las siguientes opciones:
- Buscar un repuesto alternativo compatible
- Devolver el equipo sin cargo

Por favor indiquenos como desea proceder.${appendOrdenLinks(links)}

${ctx.organizationName}`
}

function generateAvisoDemoraMessage(ctx: NotificationContext): string {
  const formatDate = (date: Date) => formatDateValue(date, ctx.zonaHoraria)

  let mensaje = `Hola ${ctx.cliente.nombre}, le informamos que la reparacion de su ${ctx.orden!.dispositivo} (Orden #${ctx.orden!.numeroOrden}) esta tomando mas tiempo del estimado.`

  if (ctx.demora?.motivo) {
    mensaje += `\n\nMotivo: ${ctx.demora.motivo}`
  }

  if (ctx.demora?.nuevaFechaEstimada) {
    mensaje += `\nNueva fecha estimada: ${formatDate(ctx.demora.nuevaFechaEstimada)}`
  }

  mensaje += appendOrdenLinks(getOrdenLinks(ctx))
  mensaje += `\n\nPedimos disculpas por la demora. Estamos trabajando para resolverlo lo antes posible.`
  mensaje += `\n\n${ctx.organizationName}`

  return mensaje
}

function generateReingresoGarantiaMessage(ctx: NotificationContext): string {
  const links = getOrdenLinks(ctx)

  return `Hola ${ctx.cliente.nombre}, lamentamos que tenga inconvenientes con su ${ctx.orden!.dispositivo}.

Su reparacion esta cubierta por garantia (valida hasta ${formatDateValue(ctx.garantia!.fechaVencimiento, ctx.zonaHoraria)}).

Puede traer su equipo para que lo revisemos sin costo adicional. No necesita turno, solo acerquese en horario de atencion.

Orden original #${ctx.orden!.numeroOrden}${appendOrdenLinks(links)}

${ctx.organizationName}`
}

function generateClienteInactivoMessage(ctx: NotificationContext): string {
  return `Hola ${ctx.cliente.nombre}, hace tiempo que no nos visita y lo extraniamos!

En ${ctx.organizationName} seguimos a su disposicion para cualquier servicio tecnico o consulta que necesite.

Recuerde que ofrecemos diagnostico sin cargo. Traiga su equipo y lo revisamos sin compromiso.

Lo esperamos!

${ctx.organizationName}`
}

function generateSeguimientoPresupuestoRechazadoMessage(ctx: NotificationContext): string {
  const links = getOrdenLinks(ctx)

  return `Hola ${ctx.cliente.nombre}, nos comunicamos por su ${ctx.orden!.dispositivo} (Orden #${ctx.orden!.numeroOrden}).

Entendemos que el presupuesto anterior no se ajustaba a sus necesidades. Queremos informarle que podemos evaluar alternativas para resolver el problema de su equipo.

Puede responder este mensaje si desea que revisemos otras opciones.${appendOrdenLinks(links)}

${ctx.organizationName}`
}

export function formatPhoneForWhatsApp(phone: string, countryCode?: string | null): string {
  // Si se proporciona país, usar la función multi-país
  if (countryCode) {
    return formatPhoneForCountry(phone, countryCode)
  }

  // Fallback: comportamiento original (Argentina)
  let cleaned = phone.replace(/\D/g, "")

  // Si empieza con 0, removemos y agregamos 54 (Argentina)
  if (cleaned.startsWith("0")) {
    cleaned = "54" + cleaned.substring(1)
  }

  // Si no tiene codigo de pais, agregar 54
  if (!cleaned.startsWith("54") && cleaned.length <= 10) {
    cleaned = "54" + cleaned
  }

  return cleaned
}

export function generateWhatsAppUrl(phone: string, message: string, countryCode?: string | null): string {
  const formattedPhone = formatPhoneForWhatsApp(phone, countryCode)
  const encodedMessage = encodeURIComponent(message)
  return `https://wa.me/${formattedPhone}?text=${encodedMessage}`
}
