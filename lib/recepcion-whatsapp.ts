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
  organizationName: string
  clienteNombre: string
  codigoRecepcion: string
  ordenes: OrdenDelLote[]
  baseUrl: string
}): string {
  const { organizationName, clienteNombre, codigoRecepcion, ordenes, baseUrl } = params

  const lineas = ordenes.map(
    (o) => `• ${o.codigoOrden} — ${o.dispositivo}\n  ${baseUrl}/seguimiento/${o.publicToken}`,
  )

  return [
    `Hola ${clienteNombre}, recibimos tus ${ordenes.length} equipos en ${organizationName}.`,
    ``,
    `Comprobante: ${codigoRecepcion}`,
    ``,
    `Podes seguir el estado de cada uno aca:`,
    ...lineas,
    ``,
    `Cualquier novedad te avisamos.`,
  ].join("\n")
}
