"use client"

import { useEffect, useSyncExternalStore } from "react"
import {
  getActiva,
  registrar,
  retirar,
  suscribir,
  type CapaId,
} from "@/lib/primer-ingreso/orquestador-capas"

/**
 * Pregunta al orquestador de primer ingreso si esta capa puede mostrarse.
 *
 * `quiere` es la decisión propia de la capa (no la cerraron para siempre, hay
 * algo para mostrar, etc.). Devuelve true solo si además es la capa elegida
 * para esta sesión. Ver lib/primer-ingreso/orquestador-capas.ts.
 */
export function useCapaPrioritaria(id: CapaId, quiere: boolean): boolean {
  useEffect(() => {
    if (!quiere) return
    registrar(id)
    return () => retirar(id)
  }, [id, quiere])

  const activa = useSyncExternalStore(suscribir, getActiva, () => null)
  return quiere && activa === id
}
