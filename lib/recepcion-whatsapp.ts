interface OrdenDelLote {
  codigoOrden: string
  dispositivo: string
  publicToken: string
}

/**
 * Arma UN mensaje con los links de seguimiento de todas las ordenes del lote.
 *
 * La recepcion multiple no dispara notificacion automatica a proposito:
 * seria un mensaje por orden. El operador manda este unico mensaje desde el
 * modal de exito (ver components/ordenes/recepcion-creada-modal.tsx).
 */
export function construirMensajeRecepcion(params: {
  /** Puede venir vacio o null: el endpoint lo permite (ver el guard abajo). */
  organizationName?: string | null
  clienteNombre: string
  codigoRecepcion: string
  ordenes: OrdenDelLote[]
  baseUrl: string
}): string {
  const { organizationName, clienteNombre, codigoRecepcion, ordenes, baseUrl } = params

  const lineas = ordenes.map(
    (o) => `• ${o.codigoOrden} — ${o.dispositivo}\n  ${baseUrl}/seguimiento/${o.publicToken}`,
  )

  // El endpoint puede devolver organizationName null (app/api/recepciones/route.ts)
  // y el modal lo normaliza a "". Sin este guard el mensaje termina en
  // "recibimos tus 3 equipos en ." — el comprobante impreso ya omite la linea
  // limpiamente cuando no hay nombre, asi que el mensaje hace lo mismo.
  const empresa = organizationName?.trim()
  const saludo = empresa
    ? `Hola ${clienteNombre}, recibimos tus ${ordenes.length} equipos en ${empresa}.`
    : `Hola ${clienteNombre}, recibimos tus ${ordenes.length} equipos.`

  return [
    saludo,
    ``,
    `Comprobante: ${codigoRecepcion}`,
    ``,
    `Podes seguir el estado de cada uno aca:`,
    ...lineas,
    ``,
    `Cualquier novedad te avisamos.`,
  ].join("\n")
}
