// Textos de `observaciones` con los que la caja reconoce una seña. Viven acá,
// sin dependencias de servidor, para que también los pueda leer el cliente.

/** Texto con que la generación del remito copia la seña a pagos_parciales (mig 249/250). */
export const OBS_ESPEJO_SENA = "Seña abonada al momento del ingreso"
/** Texto del cobro_orden de la seña al crear la orden (y el backfill de la mig 067). */
export const OBS_COBRO_SENA = "Seña al ingreso del equipo"

/**
 * La caja deduplica la seña por el texto exacto de `observaciones`: un pago
 * con esta marca no admite que se le edite el comentario.
 */
export function esMarcaDeSena(observaciones: string | null | undefined): boolean {
  return observaciones === OBS_COBRO_SENA || observaciones === OBS_ESPEJO_SENA
}
