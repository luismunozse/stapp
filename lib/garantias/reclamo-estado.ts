/**
 * Ciclo de vida de un reclamo de garantía (migración 401). Sin dependencias de
 * servidor: lo usan la API y la UI.
 *
 *   ABIERTO  -> ACEPTADO (crea el re-ingreso) | RECHAZADO (con motivo)
 *   ACEPTADO -> RESUELTO solo, al entregar la orden de re-ingreso (trigger).
 *
 * El enum de la base (estado_reclamo) no cambió: PENDIENTE es "abierto" y
 * EN_REVISION, que ya no se escribe, también cuenta como abierto.
 */

export type EstadoReclamoDb = "PENDIENTE" | "EN_REVISION" | "ACEPTADO" | "RECHAZADO" | "RESUELTO"
export type FaseReclamo = "ABIERTO" | "ACEPTADO" | "RECHAZADO" | "RESUELTO"

/** Abiertos: bloquean un reclamo nuevo sobre la misma garantía (índice único de la 401). */
export const ESTADOS_RECLAMO_ABIERTO: readonly EstadoReclamoDb[] = ["PENDIENTE", "EN_REVISION", "ACEPTADO"]
/** Por decidir: el ADMIN los puede aceptar o rechazar. */
export const ESTADOS_RECLAMO_POR_DECIDIR: readonly EstadoReclamoDb[] = ["PENDIENTE", "EN_REVISION"]

export function faseReclamo(estado: string | null | undefined): FaseReclamo {
  switch (estado) {
    case "ACEPTADO":
      return "ACEPTADO"
    case "RECHAZADO":
      return "RECHAZADO"
    case "RESUELTO":
      return "RESUELTO"
    default:
      return "ABIERTO"
  }
}

export function reclamoPorDecidir(estado: string | null | undefined): boolean {
  return (ESTADOS_RECLAMO_POR_DECIDIR as readonly string[]).includes(estado ?? "")
}

export const ETIQUETA_FASE_RECLAMO: Record<FaseReclamo, string> = {
  ABIERTO: "Por decidir",
  ACEPTADO: "Re-ingreso en curso",
  RECHAZADO: "Rechazado",
  RESUELTO: "Resuelto",
}
