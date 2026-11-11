"use client"

import { useSyncExternalStore } from "react"
import { leerUltimaListaOrdenes } from "@/lib/ordenes/filtros-url"

// sessionStorage no avisa cambios dentro de la misma pestaña, y el detalle no
// los necesita: alcanza con leerlo al montar.
const sinSuscripcion = () => () => {}
const enServidor = () => "/ordenes"

/**
 * Href del "volver" del detalle de una orden: la última lista de órdenes que
 * se vio en esta pestaña, con sus filtros (la guarda OrdenesList). En el server
 * y en la hidratación es "/ordenes", así el HTML coincide con el primer render.
 */
export function useUltimaListaOrdenes(): string {
  return useSyncExternalStore(sinSuscripcion, leerUltimaListaOrdenes, enServidor)
}
