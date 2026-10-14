import { etiquetaDeFila, filasEnOrden, type Fila, type PrevioDeFila, type VariantesState } from "@/lib/variantes-filas"

/*
 * Pure read-only helpers for the variants section: what the screen can say about the state without
 * changing it. Everything here is derived from `VariantesState`; nothing is stored.
 */

export interface EfectoDeDeshacer {
  /** Values (as they read now) that were removed and would be added back. */
  valores: string[]
  /** Labels of the OTHER rows pending archive that come back with it, because they share one of those values. */
  tambien: string[]
  /** Why the undo would be refused, in the reducer's words, or null. */
  bloqueo: string | null
}

const SIN_EFECTO: EfectoDeDeshacer = { valores: [], tambien: [], bloqueo: null }

const clave = (p: PrevioDeFila) => JSON.stringify([p.opcionId, p.valorId ?? p.valor.trim().toLowerCase()])

/**
 * Undoing a row pending archive adds back every value it needs, and any other pending row whose
 * combination is complete again returns with it. This tells the user that BEFORE they press undo,
 * mirroring `deshacerArchivo` (it reads the same snapshot through the same ids).
 */
export function efectoDeDeshacer(estado: VariantesState, fila: Fila): EfectoDeDeshacer {
  if (!fila.archivar || !fila.previos) return SIN_EFECTO

  const opcionFalta = fila.previos.find((p) => !estado.opciones.some((o) => o.id === p.opcionId))
  if (opcionFalta) return { valores: [], tambien: [], bloqueo: `Para deshacerlo, volvé a agregar la opción "${opcionFalta.opcion}"` }

  const existe = (p: PrevioDeFila) =>
    p.valorId !== null && estado.opciones.some((o) => o.id === p.opcionId && o.valores.some((v) => v.id === p.valorId))
  const faltantes = fila.previos.filter((p) => !existe(p))
  const quedanAtras = new Set(faltantes.map(clave))
  const textoActual = (p: PrevioDeFila) => estado.opciones.find((o) => o.id === p.opcionId)?.valores.find((v) => v.id === p.valorId)?.texto ?? p.valor

  const tambien = filasEnOrden(estado)
    .filter((otra) => otra.id !== fila.id && otra.archivar && otra.previos && otra.previos.length > 0)
    .filter((otra) => {
      const previos = otra.previos ?? []
      const vuelve = previos.some((p) => quedanAtras.has(clave(p)))
      return vuelve && previos.every((p) => existe(p) || quedanAtras.has(clave(p)))
    })
    .map((otra) => etiquetaDeFila(estado, otra))

  return { valores: faltantes.map(textoActual), tambien, bloqueo: null }
}
