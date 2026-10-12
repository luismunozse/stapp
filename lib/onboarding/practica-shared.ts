/**
 * Practice-order contract shared by the server and the onboarding wizard.
 *
 * Pure on purpose: no supabase or next/server import, so client components can
 * use it. Server helpers live in lib/onboarding/practica.ts.
 */

/**
 * The practice order is numbered 0. get_next_order_number (migration 048) uses
 * GREATEST(next, MAX(numero_orden) + 1), so the first real order is still #1,
 * and UNIQUE(organization_id, numero_orden) allows one practice per org.
 */
export const PRACTICA_NUMERO_ORDEN = 0

export type PracticaEstado = "RECIBIDO" | "REPARADO" | "ENTREGADO_SIN_COBRO"

export interface PracticaOrden {
  id: string
  estado: PracticaEstado
  publicToken: string
  tipoDispositivo: string
  dispositivo: string
  problemaReportado: string
  costoFinal: number | null
}

/**
 * POST /api/onboarding/practica 409 messages that retrying can never fix. The
 * wizard recognizes them by status + these exact strings to hide "Reintentar".
 */
export const PRACTICA_ERROR_ORDENES_REALES = "Ya cargaste órdenes reales: la práctica es para antes de la primera."
export const PRACTICA_ERROR_CLIENTE_SIN_TELEFONO =
  "Ya tenés un cliente cargado sin teléfono. Agregale un teléfono para poder repetir la práctica."

/** Problem chips for rubros whose tipos have no config.problemasComunes (genérico). */
export const PRACTICA_PROBLEMAS_GENERICOS = ["No enciende", "Funciona con fallas", "Hace ruido", "Mantenimiento"] as const

/** Body of the 409 that money and stock routes return for a practice order. */
export const ORDEN_PRACTICA_ERROR = { error: "Es una orden de práctica", code: "ORDEN_PRACTICA" } as const
