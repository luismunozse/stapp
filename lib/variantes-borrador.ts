import type { Fila, VariantesState } from "@/lib/variantes-filas"

// The variants section as it is written to the local draft (localStorage, in clear text, for up to 7
// days, on counters several people share). PURE and client-safe.
//
// What never goes in: the purchase price of any row and the base cost (a draft outlives the session and
// the role that typed them), photo files, blob URLs and data URLs (photos live in the photo hook, outside
// this state, and the draft only keeps the ids that had one staged).

/** A row as stored: the type has no `precioCompra`, so the cost can only be added by hand and tsc rejects it. */
export type FilaDeBorrador = Omit<Fila, "precioCompra">

export type VariantesDeBorrador = Omit<VariantesState, "costoBase" | "filas"> & { filas: Record<string, FilaDeBorrador> }

/** The state without costs. Returns a new object; the argument is untouched. */
export function aBorrador(estado: VariantesState): VariantesDeBorrador {
  const { costoBase: _costoBase, filas, ...resto } = estado
  const filasSinCosto: Record<string, FilaDeBorrador> = {}
  for (const [id, fila] of Object.entries(filas)) {
    const { precioCompra: _precioCompra, ...sinCosto } = fila
    filasSinCosto[id] = sinCosto
  }
  return structuredClone({ ...resto, filas: filasSinCosto })
}

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)

/** Shape check of what comes back from disk: a draft written by another version must not reach the reducer. */
export function esVariantesDeBorrador(x: unknown): x is VariantesDeBorrador {
  if (!esObjeto(x)) return false
  if (typeof x.activo !== "boolean" || typeof x.grupoId !== "string") return false
  if (!Array.isArray(x.opciones) || !Array.isArray(x.orden) || !esObjeto(x.filas)) return false
  const filas = x.filas
  return x.orden.every((id) => typeof id === "string" && esObjeto(filas[id]))
}

/**
 * The draft laid over what the server holds now. What the user typed comes back; what is the server's does
 * not: for a saved row the cost, stock, reserved units and photo are the current ones, the base cost is the
 * current one, and a new row gets the current base cost (or none without cost access).
 *
 * `guardado` = the product is a saved group: a draft of another group is refused (null), a saved row that no
 * longer exists is dropped and one the draft did not know is brought in (a full-state save needs every member).
 * For a new product the draft's group id wins, so a retry after a failure converges on the same group.
 */
export function restaurarVariantes(
  borrador: VariantesDeBorrador,
  actual: VariantesState,
  opciones: { guardado: boolean }
): VariantesState | null {
  if (opciones.guardado && borrador.grupoId !== actual.grupoId) return null

  const filas: Record<string, Fila> = {}
  const orden: string[] = []
  for (const id of borrador.orden) {
    const delBorrador = borrador.filas[id]
    const vigente = actual.filas[id]
    if (vigente) {
      filas[id] = {
        ...delBorrador,
        existente: vigente.existente,
        stock: vigente.stock,
        stockReservado: vigente.stockReservado,
        imagenUrl: vigente.imagenUrl,
        ...(vigente.precioCompra !== undefined ? { precioCompra: vigente.precioCompra } : {}),
      }
    } else if (opciones.guardado && delBorrador.existente) {
      continue
    } else {
      filas[id] = { ...delBorrador, ...(actual.costoCargado ? { precioCompra: actual.costoBase } : {}) }
    }
    orden.push(id)
  }
  if (opciones.guardado) {
    for (const id of actual.orden) {
      if (!(id in filas) && actual.filas[id]) {
        filas[id] = actual.filas[id]
        orden.push(id)
      }
    }
  }

  return {
    ...borrador,
    grupoId: opciones.guardado ? actual.grupoId : borrador.grupoId,
    costoBase: actual.costoBase,
    costoCargado: actual.costoCargado,
    archivadas: actual.archivadas,
    aviso: null,
    filas,
    orden,
  }
}
