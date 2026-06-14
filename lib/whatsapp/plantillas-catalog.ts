/**
 * Catálogo de plantillas de WhatsApp configurables por organización.
 *
 * Cada plantilla tiene:
 *  - key: identificador único (también es la key en plantillas_whatsapp JSONB)
 *  - label: nombre legible
 *  - category: agrupación para la UI
 *  - description: descripción breve
 *  - variables: listado de variables soportadas (para el chip clickable en UI)
 *  - defaultText: texto por defecto con placeholders {variable}
 *
 * El renderer reemplaza variables {nombre} en el texto.
 * Si la organización tiene un override en plantillas_whatsapp[key], se usa ese
 * texto. Si no, se usa defaultText.
 */

export type PlantillaCategory =
  | "ordenes"
  | "ventas"
  | "turnos"
  | "cobranza"
  | "marketing"
  | "operativo"

export interface PlantillaVariable {
  key: string
  label: string
  example?: string
}

export interface PlantillaDefinition {
  key: string
  label: string
  category: PlantillaCategory
  description: string
  variables: PlantillaVariable[]
  defaultText: string
}

const VAR_CLIENTE: PlantillaVariable = { key: "cliente", label: "Nombre del cliente", example: "Juan Pérez" }
const VAR_EMPRESA: PlantillaVariable = { key: "empresa", label: "Nombre del negocio", example: "Tu Negocio" }
const VAR_NUMERO_ORDEN: PlantillaVariable = { key: "numero_orden", label: "Número de orden", example: "1234" }
const VAR_DISPOSITIVO: PlantillaVariable = { key: "dispositivo", label: "Dispositivo", example: "iPhone 12" }
const VAR_ESTADO: PlantillaVariable = { key: "estado", label: "Estado de la orden", example: "Listo para retirar" }
const VAR_PRESUPUESTO: PlantillaVariable = { key: "presupuesto", label: "Presupuesto", example: "$45.000" }
const VAR_GARANTIA_DIAS: PlantillaVariable = { key: "garantia_dias", label: "Días de garantía", example: "90" }
const VAR_GARANTIA_FECHA: PlantillaVariable = { key: "garantia_fecha", label: "Fecha de vencimiento", example: "31/12/2026" }
const VAR_LINK_SEGUIMIENTO: PlantillaVariable = { key: "link_seguimiento", label: "Link de seguimiento", example: "https://..." }
const VAR_LINK_PDF: PlantillaVariable = { key: "link_pdf", label: "Link al PDF", example: "https://..." }
const VAR_MONTO_PAGO: PlantillaVariable = { key: "monto_pago", label: "Monto del pago", example: "$10.000" }
const VAR_SALDO: PlantillaVariable = { key: "saldo", label: "Saldo pendiente", example: "$5.000" }
const VAR_LINK_PAGO: PlantillaVariable = { key: "link_pago", label: "Link de pago", example: "https://..." }
const VAR_REPUESTO: PlantillaVariable = { key: "repuesto", label: "Nombre del repuesto", example: "Pantalla" }
const VAR_MOTIVO_DEMORA: PlantillaVariable = { key: "motivo_demora", label: "Motivo de demora", example: "Falta repuesto" }
const VAR_PROMO_TITULO: PlantillaVariable = { key: "promo_titulo", label: "Título de promoción", example: "20% OFF" }
const VAR_PROMO_DESC: PlantillaVariable = { key: "promo_descripcion", label: "Descripción de promoción" }
const VAR_NUMERO_VENTA: PlantillaVariable = { key: "numero_venta", label: "Número de venta", example: "0042" }
const VAR_TOTAL: PlantillaVariable = { key: "total", label: "Total de la venta", example: "$50.000" }
const VAR_ITEMS: PlantillaVariable = { key: "items", label: "Lista de items" }
const VAR_METODO_PAGO: PlantillaVariable = { key: "metodo_pago", label: "Método de pago", example: "Efectivo" }
const VAR_GARANTIAS: PlantillaVariable = { key: "garantias", label: "Lista de garantías" }
const VAR_FECHA: PlantillaVariable = { key: "fecha", label: "Fecha actual", example: "22/05/2026" }
const VAR_TURNO_FECHA: PlantillaVariable = { key: "turno_fecha", label: "Fecha del turno", example: "Lun 25/05" }
const VAR_TURNO_HORA: PlantillaVariable = { key: "turno_hora", label: "Hora del turno", example: "14:30" }
const VAR_TURNO_SERVICIO: PlantillaVariable = { key: "turno_servicio", label: "Servicio del turno", example: "Diagnóstico" }
const VAR_TURNO_VENTANA: PlantillaVariable = { key: "turno_ventana", label: "Ventana horaria", example: " (hasta 16:00)" }
const VAR_TURNO_DIRECCION: PlantillaVariable = { key: "turno_direccion", label: "Dirección del turno", example: "Av. Siempre Viva 123" }
const VAR_TURNO_TECNICO: PlantillaVariable = { key: "turno_tecnico", label: "Técnico asignado", example: "Carlos" }
const VAR_TURNO_EQUIPO: PlantillaVariable = { key: "turno_equipo", label: "Equipo del turno", example: "Notebook Dell" }
const VAR_LINK_SEGUIMIENTO_PUBLICO: PlantillaVariable = { key: "link_seguimiento_publico", label: "Link público de seguimiento", example: "https://..." }
const VAR_CODIGO_ORDEN: PlantillaVariable = { key: "codigo_orden", label: "Código/número de orden", example: "ORD-1234" }
const VAR_PROBLEMA: PlantillaVariable = { key: "problema", label: "Problema reportado", example: "No carga" }
const VAR_LINEA_PRESUPUESTO: PlantillaVariable = { key: "linea_presupuesto", label: "Línea presupuesto (auto)", example: "\nPresupuesto estimado: $45.000" }
const VAR_LINEA_FECHA_PROMETIDA: PlantillaVariable = { key: "linea_fecha_prometida", label: "Línea fecha estimada (auto)", example: "\nFecha estimada de entrega: 31/05/2026" }

export const PLANTILLAS_CATALOG: PlantillaDefinition[] = [
  // === Órdenes ===
  {
    key: "orden_estado_actual",
    label: "Cambio de estado de orden",
    category: "ordenes",
    description: "Se envía cuando la orden cambia de estado.",
    variables: [VAR_CLIENTE, VAR_NUMERO_ORDEN, VAR_DISPOSITIVO, VAR_ESTADO, VAR_LINK_SEGUIMIENTO, VAR_EMPRESA],
    defaultText: `Hola {cliente}, le informamos que su {dispositivo} (Orden #{numero_orden}) se encuentra {estado}. Puede ver el detalle en el link.

Seguimiento: {link_seguimiento}

{empresa}`,
  },
  {
    key: "orden_presupuesto",
    label: "Informar presupuesto",
    category: "ordenes",
    description: "Aviso al cliente con el monto del presupuesto definido.",
    variables: [VAR_CLIENTE, VAR_NUMERO_ORDEN, VAR_DISPOSITIVO, VAR_PRESUPUESTO, VAR_LINK_SEGUIMIENTO, VAR_EMPRESA],
    defaultText: `Hola {cliente}, ya tenemos el presupuesto para la reparación de su {dispositivo}:

*Presupuesto: {presupuesto}*

Orden #{numero_orden}

Para avanzar, *apruebe o rechace el presupuesto* desde el link de abajo.

Seguimiento: {link_seguimiento}

{empresa}`,
  },
  {
    key: "orden_listo_retirar",
    label: "Listo para retirar",
    category: "ordenes",
    description: "Se envía cuando el equipo está reparado y listo para entregar.",
    variables: [VAR_CLIENTE, VAR_NUMERO_ORDEN, VAR_DISPOSITIVO, VAR_LINK_SEGUIMIENTO, VAR_EMPRESA],
    defaultText: `Hola {cliente}, le recordamos que su {dispositivo} está listo para retirar.

Orden #{numero_orden}

Puede pasar por nuestro local en horario de atención. Lo esperamos!
Seguimiento: {link_seguimiento}

{empresa}`,
  },
  {
    key: "orden_entrega_completada",
    label: "Comprobante de entrega",
    category: "ordenes",
    description: "Se envía cuando se entrega el equipo al cliente.",
    variables: [VAR_CLIENTE, VAR_NUMERO_ORDEN, VAR_DISPOSITIVO, VAR_LINK_PDF, VAR_LINK_SEGUIMIENTO, VAR_EMPRESA],
    defaultText: `Hola {cliente}, confirmamos la entrega de su {dispositivo}.

*Orden #{numero_orden} - ENTREGADO*

Descargar comprobante: {link_pdf}
Seguimiento: {link_seguimiento}

Gracias por confiar en nosotros!

{empresa}`,
  },
  {
    key: "orden_compartir_seguimiento",
    label: "Compartir link de seguimiento",
    category: "ordenes",
    description: "Mensaje al compartir el link público de seguimiento de una orden.",
    variables: [VAR_CLIENTE, VAR_CODIGO_ORDEN, VAR_LINK_SEGUIMIENTO_PUBLICO, VAR_EMPRESA],
    defaultText: `Hola {cliente}, desde acá podés seguir el estado de tu equipo (Orden {codigo_orden}):
{link_seguimiento_publico}

{empresa}`,
  },
  {
    key: "orden_recepcion",
    label: "Recepción de orden nueva",
    category: "ordenes",
    description: "Mensaje que se envía al crear una orden de servicio nueva, con resumen de la recepción.",
    variables: [
      VAR_CLIENTE,
      VAR_CODIGO_ORDEN,
      VAR_DISPOSITIVO,
      VAR_PROBLEMA,
      VAR_LINEA_PRESUPUESTO,
      VAR_LINEA_FECHA_PROMETIDA,
      VAR_LINK_SEGUIMIENTO,
      VAR_LINK_PDF,
      VAR_EMPRESA,
    ],
    defaultText: `Hola {cliente}, le confirmamos la recepción de su equipo:

*ORDEN DE SERVICIO {codigo_orden}*

Dispositivo: {dispositivo}
Problema: {problema}{linea_presupuesto}{linea_fecha_prometida}

Comprobante PDF: {link_pdf}
Seguimiento en línea: {link_seguimiento}

Conserve este mensaje como comprobante.
Le avisaremos sobre el avance de la reparación.

{empresa}`,
  },
  {
    key: "orden_seguimiento",
    label: "Mensaje de seguimiento",
    category: "ordenes",
    description: "Mensaje genérico de seguimiento para una orden.",
    variables: [VAR_CLIENTE, VAR_NUMERO_ORDEN, VAR_DISPOSITIVO, VAR_LINK_SEGUIMIENTO, VAR_EMPRESA],
    defaultText: `Hola {cliente}, nos comunicamos por su {dispositivo} (Orden #{numero_orden}).

[Escriba su mensaje aquí]

Seguimiento: {link_seguimiento}

{empresa}`,
  },
  // === Plantillas por estado individual ===
  // Si está customizada se usa para ese estado específico; si no, cae a orden_estado_actual.
  {
    key: "orden_estado_recibido",
    label: "Aviso: Recibido",
    category: "ordenes",
    description: "Aviso al cliente cuando la orden entra al estado RECIBIDO.",
    variables: [VAR_CLIENTE, VAR_NUMERO_ORDEN, VAR_DISPOSITIVO, VAR_LINK_SEGUIMIENTO, VAR_EMPRESA],
    defaultText: `Hola {cliente}, le informamos que su {dispositivo} (Orden #{numero_orden}) se encuentra recibido.

Recibimos su equipo y ya está en cola de diagnóstico. Le avisaremos apenas tengamos novedades.

Seguimiento: {link_seguimiento}

{empresa}`,
  },
  {
    key: "orden_estado_en_diagnostico",
    label: "Aviso: En Diagnóstico",
    category: "ordenes",
    description: "Aviso al cliente cuando la orden entra al estado EN_DIAGNOSTICO.",
    variables: [VAR_CLIENTE, VAR_NUMERO_ORDEN, VAR_DISPOSITIVO, VAR_LINK_SEGUIMIENTO, VAR_EMPRESA],
    defaultText: `Hola {cliente}, le informamos que su {dispositivo} (Orden #{numero_orden}) se encuentra en diagnóstico.

Estamos revisando su equipo para detectar la falla. En breve le enviamos el presupuesto.

Seguimiento: {link_seguimiento}

{empresa}`,
  },
  {
    key: "orden_estado_presupuestado",
    label: "Aviso: Presupuestado",
    category: "ordenes",
    description: "Aviso al cliente cuando la orden entra al estado PRESUPUESTADO.",
    variables: [VAR_CLIENTE, VAR_NUMERO_ORDEN, VAR_DISPOSITIVO, VAR_LINK_SEGUIMIENTO, VAR_EMPRESA],
    defaultText: `Hola {cliente}, le informamos que su {dispositivo} (Orden #{numero_orden}) se encuentra presupuestado.

Para avanzar, *apruebe o rechace el presupuesto* desde el link de seguimiento de abajo. Cualquier duda, escríbanos.

Seguimiento: {link_seguimiento}

{empresa}`,
  },
  {
    key: "orden_estado_aprobado",
    label: "Aviso: Aprobado",
    category: "ordenes",
    description: "Aviso al cliente cuando la orden entra al estado APROBADO.",
    variables: [VAR_CLIENTE, VAR_NUMERO_ORDEN, VAR_DISPOSITIVO, VAR_LINK_SEGUIMIENTO, VAR_EMPRESA],
    defaultText: `Hola {cliente}, le informamos que su {dispositivo} (Orden #{numero_orden}) se encuentra aprobado.

¡Gracias por aprobar el presupuesto! Su equipo entra en cola de reparación. Le avisamos cuando esté listo.

Seguimiento: {link_seguimiento}

{empresa}`,
  },
  {
    key: "orden_estado_en_reparacion",
    label: "Aviso: En Reparación",
    category: "ordenes",
    description: "Aviso al cliente cuando la orden entra al estado EN_REPARACION.",
    variables: [VAR_CLIENTE, VAR_NUMERO_ORDEN, VAR_DISPOSITIVO, VAR_LINK_SEGUIMIENTO, VAR_EMPRESA],
    defaultText: `Hola {cliente}, le informamos que su {dispositivo} (Orden #{numero_orden}) se encuentra en reparación.

Ya estamos reparando su equipo. Le avisamos en cuanto esté terminado.

Seguimiento: {link_seguimiento}

{empresa}`,
  },
  {
    key: "orden_estado_esperando_repuesto",
    label: "Aviso: Esperando repuesto",
    category: "ordenes",
    description: "Aviso al cliente cuando la orden entra al estado ESPERANDO_REPUESTO.",
    variables: [VAR_CLIENTE, VAR_NUMERO_ORDEN, VAR_DISPOSITIVO, VAR_LINK_SEGUIMIENTO, VAR_EMPRESA],
    defaultText: `Hola {cliente}, le informamos que su {dispositivo} (Orden #{numero_orden}) se encuentra esperando repuesto.

Su reparación está en pausa esperando un repuesto. Apenas llegue, retomamos y le avisamos.

Seguimiento: {link_seguimiento}

{empresa}`,
  },
  {
    key: "orden_estado_reparado",
    label: "Aviso: Reparado / listo para retirar",
    category: "ordenes",
    description: "Aviso al cliente cuando la orden entra al estado REPARADO.",
    variables: [VAR_CLIENTE, VAR_NUMERO_ORDEN, VAR_DISPOSITIVO, VAR_LINK_SEGUIMIENTO, VAR_EMPRESA],
    defaultText: `Hola {cliente}, le informamos que su {dispositivo} (Orden #{numero_orden}) se encuentra reparado.

Su equipo está reparado y *listo para retirar*. Lo esperamos en horario de atención.

Seguimiento: {link_seguimiento}

{empresa}`,
  },
  {
    key: "orden_estado_entregado",
    label: "Aviso: Entregado",
    category: "ordenes",
    description: "Aviso al cliente cuando la orden entra al estado ENTREGADO.",
    variables: [VAR_CLIENTE, VAR_NUMERO_ORDEN, VAR_DISPOSITIVO, VAR_LINK_SEGUIMIENTO, VAR_EMPRESA],
    defaultText: `Hola {cliente}, le informamos que su {dispositivo} (Orden #{numero_orden}) se encuentra entregado.

Su equipo fue entregado. ¡Gracias por confiar en nosotros! Si necesita algo más, escríbanos.

Seguimiento: {link_seguimiento}

{empresa}`,
  },
  {
    key: "orden_estado_entregado_sin_reparacion",
    label: "Aviso: Retirado sin reparación",
    category: "ordenes",
    description: "Aviso al cliente cuando la orden entra al estado ENTREGADO_SIN_REPARACION.",
    variables: [VAR_CLIENTE, VAR_NUMERO_ORDEN, VAR_DISPOSITIVO, VAR_LINK_SEGUIMIENTO, VAR_EMPRESA],
    defaultText: `Hola {cliente}, le informamos que su {dispositivo} (Orden #{numero_orden}) se encuentra retirado sin reparación.

Su equipo fue retirado sin reparación. Gracias por consultarnos; quedamos a disposición.

Seguimiento: {link_seguimiento}

{empresa}`,
  },
  {
    key: "orden_estado_entregado_sin_cobro",
    label: "Aviso: Entregado sin cobro",
    category: "ordenes",
    description: "Aviso al cliente cuando la orden entra al estado ENTREGADO_SIN_COBRO.",
    variables: [VAR_CLIENTE, VAR_NUMERO_ORDEN, VAR_DISPOSITIVO, VAR_LINK_SEGUIMIENTO, VAR_EMPRESA],
    defaultText: `Hola {cliente}, le informamos que su {dispositivo} (Orden #{numero_orden}) se encuentra entregado sin cobro.

Su equipo fue entregado. ¡Gracias por confiar en nosotros!

Seguimiento: {link_seguimiento}

{empresa}`,
  },
  {
    key: "orden_estado_cancelado",
    label: "Aviso: Cancelado",
    category: "ordenes",
    description: "Aviso al cliente cuando la orden entra al estado CANCELADO.",
    variables: [VAR_CLIENTE, VAR_NUMERO_ORDEN, VAR_DISPOSITIVO, VAR_LINK_SEGUIMIENTO, VAR_EMPRESA],
    defaultText: `Hola {cliente}, le informamos que su {dispositivo} (Orden #{numero_orden}) se encuentra cancelado.

La orden fue cancelada. Si desea retomar o ingresar un nuevo servicio, escríbanos.

Seguimiento: {link_seguimiento}

{empresa}`,
  },
  {
    key: "orden_estado_sin_reparacion",
    label: "Aviso: Sin posibilidad de reparación",
    category: "ordenes",
    description: "Aviso al cliente cuando la orden entra al estado SIN_REPARACION.",
    variables: [VAR_CLIENTE, VAR_NUMERO_ORDEN, VAR_DISPOSITIVO, VAR_LINK_SEGUIMIENTO, VAR_EMPRESA],
    defaultText: `Hola {cliente}, le informamos que su {dispositivo} (Orden #{numero_orden}) se encuentra sin posibilidad de reparación.

No fue posible reparar su equipo. Puede pasar a retirarlo en horario de atención. Quedamos a disposición.

Seguimiento: {link_seguimiento}

{empresa}`,
  },
  {
    key: "orden_solicitud_info",
    label: "Solicitar información",
    category: "operativo",
    description: "Pedido de información adicional al cliente.",
    variables: [VAR_CLIENTE, VAR_NUMERO_ORDEN, VAR_DISPOSITIVO, VAR_EMPRESA],
    defaultText: `Hola {cliente}, nos comunicamos por su {dispositivo} (Orden #{numero_orden}).

Necesitamos información adicional para continuar con el servicio.
[Detalle lo que necesita: fotos, contraseña, descripción del problema, etc.]

Agradecemos su pronta respuesta.

{empresa}`,
  },
  {
    key: "orden_repuesto_disponible",
    label: "Repuesto disponible",
    category: "operativo",
    description: "Aviso de que el repuesto necesario llegó.",
    variables: [VAR_CLIENTE, VAR_NUMERO_ORDEN, VAR_DISPOSITIVO, VAR_REPUESTO, VAR_EMPRESA],
    defaultText: `Hola {cliente}, buenas noticias!

El repuesto *{repuesto}* para su {dispositivo} ya está disponible.

Orden #{numero_orden}

Retomamos la reparación de inmediato. Le avisaremos cuando esté listo.

{empresa}`,
  },
  {
    key: "orden_repuesto_no_disponible",
    label: "Repuesto no disponible",
    category: "operativo",
    description: "Aviso de que el repuesto no está disponible.",
    variables: [VAR_CLIENTE, VAR_NUMERO_ORDEN, VAR_DISPOSITIVO, VAR_REPUESTO, VAR_EMPRESA],
    defaultText: `Hola {cliente}, le informamos sobre su {dispositivo} (Orden #{numero_orden}).

Lamentablemente el repuesto *{repuesto}* no se encuentra disponible o está discontinuado.

Podemos ofrecerle:
- Buscar un repuesto alternativo compatible
- Devolver el equipo sin cargo

Por favor indíquenos cómo desea proceder.

{empresa}`,
  },
  {
    key: "orden_aviso_demora",
    label: "Aviso de demora",
    category: "operativo",
    description: "Aviso al cliente cuando la reparación se demora.",
    variables: [VAR_CLIENTE, VAR_NUMERO_ORDEN, VAR_DISPOSITIVO, VAR_MOTIVO_DEMORA, VAR_EMPRESA],
    defaultText: `Hola {cliente}, le informamos que la reparación de su {dispositivo} (Orden #{numero_orden}) está tomando más tiempo del estimado.

Motivo: {motivo_demora}

Pedimos disculpas por la demora. Estamos trabajando para resolverlo lo antes posible.

{empresa}`,
  },
  {
    key: "orden_seguimiento_rechazado",
    label: "Seguimiento presupuesto rechazado",
    category: "operativo",
    description: "Seguimiento cuando el cliente rechazó el presupuesto.",
    variables: [VAR_CLIENTE, VAR_NUMERO_ORDEN, VAR_DISPOSITIVO, VAR_EMPRESA],
    defaultText: `Hola {cliente}, nos comunicamos por su {dispositivo} (Orden #{numero_orden}).

Entendemos que el presupuesto anterior no se ajustaba a sus necesidades. Podemos evaluar alternativas para resolver el problema de su equipo.

Puede responder este mensaje si desea que revisemos otras opciones.

{empresa}`,
  },

  // === Garantías ===
  {
    key: "garantia_creada",
    label: "Garantía emitida",
    category: "ordenes",
    description: "Aviso al cliente con los datos de la garantía.",
    variables: [VAR_CLIENTE, VAR_NUMERO_ORDEN, VAR_DISPOSITIVO, VAR_GARANTIA_DIAS, VAR_GARANTIA_FECHA, VAR_EMPRESA],
    defaultText: `Hola {cliente}, su reparación cuenta con garantía:

*{garantia_dias} días de garantía*
Válida hasta: {garantia_fecha}

Orden #{numero_orden}
Dispositivo: {dispositivo}

Conserve este mensaje como comprobante.

{empresa}`,
  },
  {
    key: "garantia_reingreso",
    label: "Reingreso por garantía",
    category: "ordenes",
    description: "Aviso para reingresos por garantía vigente.",
    variables: [VAR_CLIENTE, VAR_NUMERO_ORDEN, VAR_DISPOSITIVO, VAR_GARANTIA_FECHA, VAR_EMPRESA],
    defaultText: `Hola {cliente}, lamentamos que tenga inconvenientes con su {dispositivo}.

Su reparación está cubierta por garantía (válida hasta {garantia_fecha}).

Puede traer su equipo para que lo revisemos sin costo adicional. No necesita turno, sólo acérquese en horario de atención.

Orden original #{numero_orden}

{empresa}`,
  },

  // === Ventas ===
  {
    key: "venta_comprobante",
    label: "Comprobante de venta (texto completo)",
    category: "ventas",
    description: "Mensaje completo al compartir un comprobante de venta.",
    variables: [VAR_CLIENTE, VAR_NUMERO_VENTA, VAR_ITEMS, VAR_TOTAL, VAR_METODO_PAGO, VAR_GARANTIAS, VAR_EMPRESA, VAR_FECHA],
    defaultText: `Hola {cliente}, gracias por tu compra!

*COMPROBANTE DE VENTA #{numero_venta}*

{items}

*Total: {total}*
Método de pago: {metodo_pago}

{garantias}

Gracias por tu preferencia!
{empresa}`,
  },
  {
    key: "venta_comprobante_corto",
    label: "Comprobante de venta (al compartir imagen)",
    category: "ventas",
    description: "Mensaje corto que acompaña a la imagen del ticket compartido.",
    variables: [VAR_CLIENTE, VAR_NUMERO_VENTA, VAR_TOTAL, VAR_EMPRESA],
    defaultText: `Hola {cliente}, gracias por tu compra!
Venta #{numero_venta} por {total}.
Te enviamos el comprobante como imagen.`,
  },
  {
    key: "venta_garantias",
    label: "Informar garantías de venta",
    category: "ventas",
    description: "Aviso con los certificados de garantía de una venta.",
    variables: [VAR_CLIENTE, VAR_NUMERO_VENTA, VAR_GARANTIAS, VAR_EMPRESA],
    defaultText: `Hola {cliente}, su compra (V{numero_venta}) incluye garantía:

{garantias}

Conserve estos certificados como comprobante.

{empresa}`,
  },
  {
    key: "venta_agradecimiento",
    label: "Agradecimiento post-venta",
    category: "ventas",
    description: "Mensaje de agradecimiento luego de una venta.",
    variables: [VAR_CLIENTE, VAR_EMPRESA],
    defaultText: `Hola {cliente}, gracias por elegirnos!

Esperamos que disfrute su compra. Si tiene alguna consulta, no dude en contactarnos.

Lo esperamos pronto!

{empresa}`,
  },

  // === Cobranza ===
  {
    key: "cobranza_recordatorio_pago",
    label: "Recordatorio de pago",
    category: "cobranza",
    description: "Recordatorio de saldo pendiente.",
    variables: [VAR_CLIENTE, VAR_SALDO, VAR_NUMERO_ORDEN, VAR_EMPRESA],
    defaultText: `Hola {cliente}, le recordamos que tiene un saldo pendiente de *{saldo}*.

Orden #{numero_orden}

Puede acercarse a nuestro local o consultarnos por medios de pago disponibles.

{empresa}`,
  },
  {
    key: "cobranza_confirmacion_pago",
    label: "Confirmación de pago",
    category: "cobranza",
    description: "Confirmación de pago recibido.",
    variables: [VAR_CLIENTE, VAR_MONTO_PAGO, VAR_SALDO, VAR_EMPRESA],
    defaultText: `Hola {cliente}, confirmamos la recepción de su pago por *{monto_pago}*.

Saldo restante: {saldo}

Gracias!

{empresa}`,
  },
  {
    key: "cobranza_link_pago",
    label: "Enviar link de pago",
    category: "cobranza",
    description: "Mensaje con link para que el cliente pague.",
    variables: [VAR_CLIENTE, VAR_MONTO_PAGO, VAR_LINK_PAGO, VAR_EMPRESA],
    defaultText: `Hola {cliente}, le enviamos el link para realizar el pago:

*Monto: {monto_pago}*

{link_pago}

{empresa}`,
  },

  // === Turnos ===
  {
    key: "turno_confirmacion",
    label: "Confirmación de turno",
    category: "turnos",
    description: "Confirmación cuando se agenda un turno.",
    variables: [VAR_CLIENTE, VAR_TURNO_FECHA, VAR_TURNO_VENTANA, VAR_TURNO_DIRECCION, VAR_TURNO_TECNICO, VAR_TURNO_EQUIPO, VAR_EMPRESA],
    defaultText: `*{empresa}*
Tu turno fue agendado ✅

📅 {turno_fecha}{turno_ventana}
📍 {turno_direccion}
👤 Técnico: {turno_tecnico}
🔧 Equipo: {turno_equipo}

Cualquier cambio, avisanos. ¡Gracias!`,
  },
  {
    key: "turno_recordatorio_24h",
    label: "Recordatorio de turno (24h antes)",
    category: "turnos",
    description: "Recordatorio enviado un día antes del turno.",
    variables: [VAR_CLIENTE, VAR_TURNO_FECHA, VAR_TURNO_VENTANA, VAR_TURNO_DIRECCION, VAR_TURNO_TECNICO, VAR_TURNO_EQUIPO, VAR_EMPRESA],
    defaultText: `*{empresa}*
Te recordamos tu turno de mañana ⏰

📅 {turno_fecha}{turno_ventana}
📍 {turno_direccion}
👤 Técnico: {turno_tecnico}
🔧 Equipo: {turno_equipo}`,
  },
  {
    key: "turno_recordatorio_1h",
    label: "Recordatorio de turno (1h antes)",
    category: "turnos",
    description: "Recordatorio enviado una hora antes del turno.",
    variables: [VAR_CLIENTE, VAR_TURNO_FECHA, VAR_TURNO_VENTANA, VAR_TURNO_DIRECCION, VAR_TURNO_TECNICO, VAR_EMPRESA],
    defaultText: `*{empresa}*
Tu turno es en aproximadamente 1 hora.

📅 {turno_fecha}{turno_ventana}
📍 {turno_direccion}
👤 Técnico: {turno_tecnico}`,
  },
  {
    key: "turno_reprogramado",
    label: "Turno reprogramado",
    category: "turnos",
    description: "Aviso cuando se reprograma un turno.",
    variables: [VAR_CLIENTE, VAR_TURNO_FECHA, VAR_TURNO_VENTANA, VAR_TURNO_DIRECCION, VAR_EMPRESA],
    defaultText: `*{empresa}*
Reprogramamos tu turno 📅
Nueva fecha: {turno_fecha}{turno_ventana}
📍 {turno_direccion}`,
  },
  {
    key: "turno_cancelado",
    label: "Cancelación de turno",
    category: "turnos",
    description: "Aviso cuando se cancela un turno.",
    variables: [VAR_CLIENTE, VAR_TURNO_FECHA, VAR_EMPRESA],
    defaultText: `*{empresa}*
Tu turno del {turno_fecha} fue cancelado.
Si querés reagendar, respondé este mensaje.`,
  },
  {
    key: "turno_tecnico_en_camino",
    label: "Técnico en camino",
    category: "turnos",
    description: "Aviso cuando el técnico salió hacia el turno.",
    variables: [VAR_CLIENTE, VAR_TURNO_TECNICO, VAR_TURNO_FECHA, VAR_EMPRESA],
    defaultText: `*{empresa}*
🚗 {turno_tecnico} está en camino para tu turno de {turno_fecha}.`,
  },

  // === Marketing / Captación / Retención ===
  {
    key: "bienvenida_cliente",
    label: "Bienvenida cliente nuevo",
    category: "marketing",
    description: "Mensaje de bienvenida a clientes nuevos.",
    variables: [VAR_CLIENTE, VAR_EMPRESA],
    defaultText: `Hola {cliente}, bienvenido/a a {empresa}!

Gracias por confiar en nosotros. Somos especialistas en reparación y servicio técnico.

Puede contactarnos por este medio para cualquier consulta.

{empresa}`,
  },
  {
    key: "respuesta_consulta",
    label: "Respuesta a consulta",
    category: "marketing",
    description: "Respuesta genérica a una consulta inicial.",
    variables: [VAR_CLIENTE, VAR_EMPRESA],
    defaultText: `Hola {cliente}, gracias por su consulta.

[Detalle su respuesta aquí]

Si desea traer su equipo para una revisión sin cargo, estamos a su disposición.

{empresa}`,
  },
  {
    key: "mantenimiento_preventivo",
    label: "Recordatorio mantenimiento preventivo",
    category: "marketing",
    description: "Aviso para recordar mantenimiento preventivo.",
    variables: [VAR_CLIENTE, VAR_EMPRESA],
    defaultText: `Hola {cliente}, desde {empresa} queremos recordarle que es buen momento para un chequeo preventivo de su equipo.

El mantenimiento preventivo ayuda a evitar fallas y prolongar la vida útil de su equipo.

Consulte por turno disponible!

{empresa}`,
  },
  {
    key: "promocion",
    label: "Promoción / Oferta",
    category: "marketing",
    description: "Mensaje para difundir una promoción.",
    variables: [VAR_CLIENTE, VAR_PROMO_TITULO, VAR_PROMO_DESC, VAR_EMPRESA],
    defaultText: `Hola {cliente}!

*{promo_titulo}*
{promo_descripcion}

No dude en consultarnos!

{empresa}`,
  },
  {
    key: "encuesta_satisfaccion",
    label: "Encuesta de satisfacción",
    category: "marketing",
    description: "Pedido de feedback post-servicio.",
    variables: [VAR_CLIENTE, VAR_DISPOSITIVO, VAR_EMPRESA],
    defaultText: `Hola {cliente}, nos importa su opinión!

Queremos saber cómo fue su experiencia con la reparación de su {dispositivo}.

Del 1 al 5, ¿qué tan satisfecho está? (1 = Muy insatisfecho, 5 = Excelente)

Su opinión nos ayuda a mejorar. Gracias!

{empresa}`,
  },
  {
    key: "felicitacion",
    label: "Felicitación / Saludo",
    category: "marketing",
    description: "Saludo personalizado (cumpleaños, fin de año, etc).",
    variables: [VAR_CLIENTE, VAR_EMPRESA],
    defaultText: `Hola {cliente}, desde {empresa} queremos desearle un muy feliz día!

Gracias por ser parte de nuestra comunidad de clientes.

Como regalo, tiene un descuento especial en su próximo servicio. Consulte por mensaje!

{empresa}`,
  },
  {
    key: "cliente_inactivo",
    label: "Cliente inactivo",
    category: "marketing",
    description: "Mensaje de reactivación para clientes que no visitan hace tiempo.",
    variables: [VAR_CLIENTE, VAR_EMPRESA],
    defaultText: `Hola {cliente}, hace tiempo que no nos visita y lo extrañamos!

En {empresa} seguimos a su disposición para cualquier servicio técnico o consulta.

Recuerde que ofrecemos diagnóstico sin cargo. Traiga su equipo y lo revisamos sin compromiso.

Lo esperamos!

{empresa}`,
  },
  {
    key: "catalogo_carrito_abandonado_recovery",
    label: "Recuperación de carrito abandonado",
    category: "marketing",
    description: "Mensaje que envía el admin desde el panel de carritos abandonados para invitar al cliente a finalizar la compra.",
    variables: [
      VAR_CLIENTE,
      VAR_ITEMS,
      VAR_TOTAL,
      { key: "link_catalogo", label: "Link al catálogo", example: "https://miempresa.stapp.com.ar/catalogo/equipos" },
      VAR_EMPRESA,
    ],
    defaultText: `Hola {cliente}! Te escribo de parte del catálogo. Vi que dejaste estos items pendientes:

{items}

Total estimado: {total}.
¿Querés que te ayudemos a finalizar la compra?
{link_catalogo}

{empresa}`,
  },
  {
    key: "seguimiento_consulta_cliente",
    label: "Consulta cliente desde seguimiento público",
    category: "operativo",
    description: "Mensaje pre-rellenado que el cliente envía al taller desde el botón WhatsApp de la página pública de seguimiento.",
    variables: [VAR_CLIENTE, VAR_CODIGO_ORDEN, VAR_DISPOSITIVO],
    defaultText: `Hola, consulto por la orden {codigo_orden} ({dispositivo}).`,
  },
  {
    key: "catalogo_solicitud_taller",
    label: "Aviso al taller por nueva solicitud (catálogo)",
    category: "operativo",
    description: "Mensaje pre-armado que el cliente envía al WhatsApp del taller al confirmar una cotización pública desde el catálogo.",
    variables: [
      { key: "taller", label: "Nombre del taller", example: "Servicio Técnico" },
      { key: "numero_cotizacion", label: "Número de cotización", example: "C-0042" },
      { key: "cliente", label: "Nombre del cliente", example: "Juan Pérez" },
      { key: "telefono", label: "Teléfono del cliente", example: "+54 9 11 1234-5678" },
      VAR_ITEMS,
      VAR_TOTAL,
      { key: "linea_cupon", label: "Línea de cupón (auto)", example: "\nCupón: SAVE10 (-$5.000)" },
      { key: "link_publico", label: "Link público de la cotización", example: "https://miempresa.stapp.com.ar/cotizacion/abc123" },
    ],
    defaultText: `Hola {taller}! Acabo de enviar una solicitud desde el catálogo:

Solicitud N° {numero_cotizacion}
Cliente: {cliente}
Tel: {telefono}

{items}

Total: {total}{linea_cupon}

Detalle completo: {link_publico}`,
  },
]

export const CATEGORIES: Record<PlantillaCategory, { label: string; description: string }> = {
  ordenes: { label: "Órdenes", description: "Notificaciones sobre el flujo de reparación" },
  ventas: { label: "Ventas", description: "Comprobantes y agradecimientos de venta" },
  turnos: { label: "Turnos", description: "Confirmaciones y recordatorios de turnos" },
  cobranza: { label: "Cobranza", description: "Pagos, saldos y links de pago" },
  operativo: { label: "Operativo", description: "Repuestos, demoras e información" },
  marketing: { label: "Marketing", description: "Captación, retención y fidelización" },
}

export function getPlantilla(key: string): PlantillaDefinition | undefined {
  return PLANTILLAS_CATALOG.find((p) => p.key === key)
}

export function getPlantillasByCategory(): Record<PlantillaCategory, PlantillaDefinition[]> {
  const grouped = {} as Record<PlantillaCategory, PlantillaDefinition[]>
  for (const cat of Object.keys(CATEGORIES) as PlantillaCategory[]) {
    grouped[cat] = PLANTILLAS_CATALOG.filter((p) => p.category === cat)
  }
  return grouped
}

/**
 * Renderiza un texto reemplazando variables {variable} con valores del contexto.
 * Variables no encontradas en el contexto se dejan vacías.
 */
export function renderTemplate(
  text: string,
  ctx: Record<string, string | number | null | undefined>,
): string {
  return text
    .replace(/\{(\w+)\}/g, (_, key) => {
      const v = ctx[key]
      if (v === null || v === undefined) return ""
      return String(v)
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/**
 * Resuelve el texto para una plantilla: si hay override del usuario en
 * plantillasOverride, se renderiza; si no, se renderiza el defaultText.
 */
export function resolvePlantilla(
  key: string,
  ctx: Record<string, string | number | null | undefined>,
  plantillasOverride?: Record<string, string> | null,
): string {
  const def = getPlantilla(key)
  const tpl = plantillasOverride?.[key]?.trim() || def?.defaultText || ""
  return renderTemplate(tpl, ctx)
}
