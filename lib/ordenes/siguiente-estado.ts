/**
 * La acción principal de una orden según su estado: el paso que el taller da
 * casi siempre. La ficha lo muestra como un botón grande y deja el resto de las
 * transiciones en "Más estados…".
 *
 * Cada destino es una transición válida de TRANSICIONES_VALIDAS (hay un test
 * que lo verifica), así que el botón nunca ofrece algo que el backend rechace.
 */
import type { EstadoOrden } from "@/types"

export interface AccionEstado {
  estado: EstadoOrden
  /** Texto del botón, en imperativo. */
  label: string
}

const SIGUIENTE: Partial<Record<EstadoOrden, AccionEstado>> = {
  RECIBIDO: { estado: "EN_DIAGNOSTICO", label: "Empezar diagnóstico" },
  EN_DIAGNOSTICO: { estado: "PRESUPUESTADO", label: "Pasar a presupuestado" },
  PRESUPUESTADO: { estado: "APROBADO", label: "Marcar aprobado" },
  APROBADO: { estado: "EN_REPARACION", label: "Empezar reparación" },
  EN_REPARACION: { estado: "REPARADO", label: "Marcar reparado" },
  ESPERANDO_REPUESTO: { estado: "EN_REPARACION", label: "Seguir reparación" },
  REPARADO: { estado: "ENTREGADO", label: "Entregar" },
  SIN_FALLA_DETECTADA: { estado: "ENTREGADO", label: "Entregar" },
  SIN_REPARACION: { estado: "ENTREGADO_SIN_REPARACION", label: "Entregar sin reparar" },
}

export function siguienteEstado(estado: EstadoOrden): AccionEstado | null {
  return SIGUIENTE[estado] ?? null
}
