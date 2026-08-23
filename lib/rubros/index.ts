import type { RubroPack } from "./types"
import { electronica } from "./packs/electronica"
import { electrodomesticos } from "./packs/electrodomesticos"
import { automotor } from "./packs/automotor"
import { motosBicicletas } from "./packs/motos-bicicletas"
import { relojeria } from "./packs/relojeria"
import { generico } from "./packs/generico"

export type { RubroPack, RubroTipo, RubroChecklist, RubroChecklistItem } from "./types"

/**
 * Registro de rubros. El orden es el que ve el usuario en el selector del
 * registro: el genérico va último a propósito, para que no sea la salida fácil.
 *
 * Este archivo es PURO (sin supabase) porque lo importa el cliente. La siembra
 * vive en `lib/rubros/seed.ts`, que sí toca la base.
 */
export const RUBROS: RubroPack[] = [
  electronica,
  electrodomesticos,
  automotor,
  motosBicicletas,
  relojeria,
  generico,
]

export const RUBRO_IDS: string[] = RUBROS.map((r) => r.id)

export const DEFAULT_RUBRO_ID = "generico"

const POR_ID = new Map(RUBROS.map((r) => [r.id, r]))

export function isRubroId(value: unknown): boolean {
  return typeof value === "string" && POR_ID.has(value)
}

/**
 * Resuelve un pack. Nunca falla: un id desconocido, null o vacío cae al
 * genérico, así una org vieja sin `rubro` sigue funcionando.
 */
export function getRubro(id: string | null | undefined): RubroPack {
  if (typeof id === "string") {
    const pack = POR_ID.get(id)
    if (pack) return pack
  }
  return POR_ID.get(DEFAULT_RUBRO_ID)!
}

/** Metadata liviana para el selector del registro (sin configs ni checklists). */
export function listRubrosParaSelector() {
  return RUBROS.map((r) => ({
    id: r.id,
    nombre: r.nombre,
    descripcion: r.descripcion,
    icono: r.icono,
    ejemplos: r.tipos
      .filter((t) => t.codigo !== "TODOS")
      .slice(0, 4)
      .map((t) => t.nombre),
  }))
}
