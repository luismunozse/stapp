/**
 * LA acción principal de la ficha de una orden, según el estado y quién mira.
 * La barra fija del celular y la tarjeta Estado leen lo mismo de acá, así que
 * nunca ofrecen cosas distintas.
 *
 * No inventa acciones: cada una es algo que la ficha ya hacía (cambiar de
 * estado por `handleUpdateEstado`, tomar la orden, cobrar). Los cambios de
 * estado salen de `siguienteEstado`, que está atado a la máquina de estados.
 */
import type { EstadoOrden } from "@/types"
import { siguienteEstado, type AccionEstado } from "@/lib/ordenes/siguiente-estado"

export type RolUsuario = "ADMIN" | "VENDEDOR" | "TECNICO" | string | undefined

export type AccionPrincipal =
  | ({ tipo: "estado" } & AccionEstado)
  | { tipo: "tomar"; label: string }
  | { tipo: "cobrar"; label: string }

export interface EntradaAccionPrincipal {
  estado: EstadoOrden
  rol: RolUsuario
  /** La orden está asignada a quien mira (solo importa para TECNICO). */
  asignadaAMi: boolean
  /** El servidor dice que este técnico puede tomarla (sin asignar, la org lo permite). */
  puedeTomar: boolean
  /** Hay saldo y quien mira puede cobrarlo (mismas condiciones que el botón de la tarjeta de costos). */
  puedeCobrarSaldo: boolean
}

export interface ResultadoAccionPrincipal {
  /** El botón principal, o null si no hay nada que empujar. */
  principal: AccionPrincipal | null
  /** "Cobrar" va al lado, como secundaria, cuando no es ya la principal. */
  cobrarSecundario: boolean
  /** Quien mira puede cambiar el estado (la API rechaza a un técnico que no la tiene asignada). */
  puedeCambiarEstado: boolean
}

/**
 * Estados donde el próximo paso es de mostrador (la aprobación del cliente y la
 * entrega): al técnico no se le ofrecen como principal, pero siguen en
 * "Más estados…" porque la API se los permite.
 */
const PASOS_DE_MOSTRADOR: ReadonlySet<EstadoOrden> = new Set<EstadoOrden>([
  "PRESUPUESTADO",
  "REPARADO",
  "SIN_FALLA_DETECTADA",
  "SIN_REPARACION",
])

export function accionPrincipalOrden(e: EntradaAccionPrincipal): ResultadoAccionPrincipal {
  const esTecnico = e.rol === "TECNICO"
  const puedeCambiarEstado = !esTecnico || e.asignadaAMi
  // Un técnico nunca cobra (OrdenCostosCard queda en solo lectura para él).
  const cobrar = e.puedeCobrarSaldo && !esTecnico

  if (!puedeCambiarEstado) {
    const principal: AccionPrincipal | null = e.puedeTomar ? { tipo: "tomar", label: "Tomar orden" } : null
    return { principal, cobrarSecundario: false, puedeCambiarEstado }
  }

  const siguiente = siguienteEstado(e.estado)
  if (siguiente && !(esTecnico && PASOS_DE_MOSTRADOR.has(e.estado))) {
    return { principal: { tipo: "estado", ...siguiente }, cobrarSecundario: cobrar, puedeCambiarEstado }
  }

  if (cobrar) {
    return { principal: { tipo: "cobrar", label: "Cobrar" }, cobrarSecundario: false, puedeCambiarEstado }
  }

  return { principal: null, cobrarSecundario: false, puedeCambiarEstado }
}
