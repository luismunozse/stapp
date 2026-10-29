// Rules for the opt-in permission `tecnicos_toman_ordenes` (migration 374):
// a TECNICO may pick up repair orders that have no technician yet.
//
// Pure on purpose: no I/O, so the list, the detail and the "take" endpoint all
// agree on what "can be taken" means.

// Terminal states. Taking a closed order would hand the new technician a
// commission snapshot on work he never did, and there is nothing left to work
// on, so these are never takeable even though the list still shows them.
export const ESTADOS_ORDEN_CERRADA: readonly string[] = [
  "ENTREGADO",
  "ENTREGADO_SIN_REPARACION",
  "ENTREGADO_SIN_COBRO",
  "CANCELADO",
  "SIN_REPARACION",
  "SIN_FALLA_DETECTADA",
]

/** True when the order has no technician and is still open. */
export function ordenSeTomaPorTecnico(orden: {
  tecnico_id?: string | null
  estado?: string | null
}): boolean {
  if (orden.tecnico_id) return false
  return !ESTADOS_ORDEN_CERRADA.includes(orden.estado ?? "")
}
