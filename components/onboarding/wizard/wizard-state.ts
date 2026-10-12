import { DEFAULT_RUBRO_ID, getRubro } from "@/lib/rubros"
import {
  PRACTICA_PROBLEMAS_GENERICOS,
  type PracticaEstado,
  type PracticaOrden,
} from "@/lib/onboarding/practica-shared"
import type { PasoWizard, SubPasoPractica, TipoPractica } from "./types"

export const PASOS: { key: PasoWizard; titulo: string }[] = [
  { key: "bienvenida", titulo: "Bienvenida" },
  { key: "negocio", titulo: "Tu negocio" },
  { key: "pregunta", titulo: "Primera orden" },
  { key: "practica", titulo: "Práctica" },
  { key: "listo", titulo: "Listo" },
]

const SUBPASO_POR_ESTADO: Record<PracticaEstado, SubPasoPractica> = {
  RECIBIDO: "reparar",
  REPARADO: "entregar",
  ENTREGADO_SIN_COBRO: "terminada",
}

/** Where the practice continues: the next action, derived from the server state. */
export function subPasoPractica(practica: PracticaOrden | null): SubPasoPractica {
  return practica ? SUBPASO_POR_ESTADO[practica.estado] : "recibir"
}

/** A user who left mid-practice resumes there; a finished practice lands on Listo. */
export function pasoInicial(practica: PracticaOrden | null): PasoWizard {
  const sub = subPasoPractica(practica)
  if (sub === "recibir") return "bienvenida"
  if (sub === "terminada") return "listo"
  return "practica"
}

export function etiquetaRubro(rubro: string, rubroDetalle: string | null): string {
  const pack = getRubro(rubro)
  const detalle = rubroDetalle?.trim() ?? ""
  if (pack.id === DEFAULT_RUBRO_ID && detalle !== "") {
    return detalle.charAt(0).toUpperCase() + detalle.slice(1)
  }
  return pack.nombre
}

function limpiar(lista: string[], max: number): string[] {
  return Array.from(new Set(lista.map((s) => s.trim()).filter(Boolean))).slice(0, max)
}

/** Problem chips: the tipo's own, or the fixed list (genérico tipos have none). */
export function problemasParaPractica(tipo: TipoPractica | undefined): string[] {
  const propios = limpiar(tipo?.problemasComunes ?? [], 6)
  return propios.length > 0 ? propios : [...PRACTICA_PROBLEMAS_GENERICOS]
}

export function marcasParaPractica(tipo: TipoPractica | undefined): string[] {
  return limpiar(tipo?.marcas ?? [], 8)
}
