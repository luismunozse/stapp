/**
 * Accesorios recibidos: resolución del valor que se guarda con la orden.
 *
 * Vive fuera de los formularios porque los dos que cargan equipos (el alta
 * clásica y la recepción de varios equipos) tienen que resolverlo igual, y
 * porque así se puede testear sin montar ningún wizard.
 */

/**
 * Accesorios que corresponde guardar, incluyendo el texto libre que quedó
 * escrito en "Otro accesorio..." sin agregarse con "+" ni con Enter.
 *
 * Ese texto cuenta como cargado: el operador lo escribió, lo ve en pantalla y
 * aprieta "Crear Orden". Descartarlo dejaba el comprobante con "Accesorios
 * recibidos —" sobre un equipo que sí los tenía — y ese papel es el que firma
 * el cliente al dejar el equipo.
 */
export function accesoriosConPendiente(seleccionados: string[], pendiente: string): string[] {
  const texto = pendiente.trim()
  if (!texto || seleccionados.includes(texto)) return seleccionados
  return [...seleccionados, texto]
}
