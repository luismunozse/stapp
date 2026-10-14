import { crearReductor, etiquetaDeFila, filasEnOrden, type Fila, type VariantesState } from "@/lib/variantes-filas"

/*
 * Pure read-only helpers for the variants section: what the screen can say about the state without
 * changing it. Everything here is derived from `VariantesState`; nothing is stored.
 */

export interface EfectoDeDeshacer {
  /** Values (as they read now) that were removed and would be added back. */
  valores: string[]
  /** Labels of the OTHER rows pending archive that come back with it, because they share one of those values. */
  tambien: string[]
  /** Labels of brand-new rows the undo creates because the returning values complete new combinations. */
  nuevas: string[]
  /** Labels of children archived in the database that the undo restores. */
  restauradas: string[]
  /** Why the undo would be refused, in the reducer's words, or null. */
  bloqueo: string | null
}

const sinEfecto = (): EfectoDeDeshacer => ({ valores: [], tambien: [], nuevas: [], restauradas: [], bloqueo: null })

/**
 * What pressing "Deshacer" on a row pending archive will do, so the user is told BEFORE pressing. It is not
 * a second implementation of the undo: it RUNS the reducer (pure, with replay-stable ids) on the current state
 * and compares the result with it, so the prediction can never drift from what happens.
 */
export function efectoDeDeshacer(estado: VariantesState, fila: Fila): EfectoDeDeshacer {
  if (!fila.archivar) return sinEfecto()

  const despues = crearReductor()(estado, { tipo: "deshacerArchivo", filaId: fila.id })
  // An accepted action clears the message, so one left behind is the reason the undo was refused.
  if (despues.aviso !== null) return { ...sinEfecto(), bloqueo: despues.aviso }

  const valoresAntes = new Set(estado.opciones.flatMap((o) => o.valores.map((v) => v.id)))
  const valores = despues.opciones.flatMap((o) => o.valores.filter((v) => !valoresAntes.has(v.id)).map((v) => v.texto))

  const efecto: EfectoDeDeshacer = { ...sinEfecto(), valores }
  for (const otra of filasEnOrden(despues)) {
    if (otra.id === fila.id) continue
    const antes = estado.filas[otra.id]
    if (antes) {
      if (antes.archivar && !otra.archivar) efecto.tambien.push(etiquetaDeFila(despues, otra))
    } else if (estado.archivadas[otra.id]) {
      efecto.restauradas.push(etiquetaDeFila(despues, otra))
    } else {
      efecto.nuevas.push(etiquetaDeFila(despues, otra))
    }
  }
  return efecto
}

const lista = (items: string[]) => items.join(", ")

/** "a, b y c": the last one joined with "y". */
const unir = (partes: string[]) => (partes.length < 2 ? (partes[0] ?? "") : `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`)

/** The sentence for the row: null when the undo is just that row coming back. */
export function describirEfecto(efecto: EfectoDeDeshacer): string | null {
  if (efecto.bloqueo) return efecto.bloqueo
  const uno = (items: string[], singular: string, plural: string) => (items.length === 1 ? singular : plural)
  const partes: string[] = []
  if (efecto.valores.length > 0) partes.push(`${uno(efecto.valores, "se vuelve", "se vuelven")} a agregar ${lista(efecto.valores)}`)
  if (efecto.tambien.length > 0) partes.push(`también ${uno(efecto.tambien, "vuelve", "vuelven")} ${lista(efecto.tambien)}`)
  if (efecto.nuevas.length > 0) partes.push(`${uno(efecto.nuevas, "se agrega", "se agregan")} ${lista(efecto.nuevas)}`)
  if (efecto.restauradas.length > 0) partes.push(`${uno(efecto.restauradas, "se restaura", "se restauran")} ${lista(efecto.restauradas)}`)
  return partes.length > 0 ? `Al deshacer ${unir(partes)}` : null
}
