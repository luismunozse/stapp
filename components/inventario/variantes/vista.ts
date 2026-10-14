import { bloqueos, crearReductor, etiquetaDeFila, filasEnOrden, type Fila, type VariantesState } from "@/lib/variantes-filas"

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

interface Analisis {
  efecto: EfectoDeDeshacer
  /** The rows that stop being pending after the undo, the asked one included, in the order of the rows. */
  devueltas: { id: string; etiqueta: string }[]
}

/**
 * What pressing "Deshacer" on a row pending archive will do, so the user is told BEFORE pressing. It is not
 * a second implementation of the undo: it RUNS the reducer (pure, with replay-stable ids) on the current state
 * and compares the result with it, so the prediction can never drift from what happens.
 */
function analizar(estado: VariantesState, fila: Fila): Analisis {
  if (!fila.archivar) return { efecto: sinEfecto(), devueltas: [] }

  const despues = crearReductor()(estado, { tipo: "deshacerArchivo", filaId: fila.id })
  // An accepted action clears the message, so one left behind is the reason the undo was refused.
  if (despues.aviso !== null) return { efecto: { ...sinEfecto(), bloqueo: despues.aviso }, devueltas: [] }

  const valoresAntes = new Set(estado.opciones.flatMap((o) => o.valores.map((v) => v.id)))
  const valores = despues.opciones.flatMap((o) => o.valores.filter((v) => !valoresAntes.has(v.id)).map((v) => v.texto))

  const efecto: EfectoDeDeshacer = { ...sinEfecto(), valores }
  const devueltas: Analisis["devueltas"] = []
  for (const otra of filasEnOrden(despues)) {
    const etiqueta = etiquetaDeFila(despues, otra)
    if (otra.id === fila.id) {
      devueltas.push({ id: otra.id, etiqueta })
      continue
    }
    const antes = estado.filas[otra.id]
    if (antes) {
      if (antes.archivar && !otra.archivar) {
        efecto.tambien.push(etiqueta)
        devueltas.push({ id: otra.id, etiqueta })
      }
    } else if (estado.archivadas[otra.id]) {
      efecto.restauradas.push(etiqueta)
    } else {
      efecto.nuevas.push(etiqueta)
    }
  }
  return { efecto, devueltas }
}

export function efectoDeDeshacer(estado: VariantesState, fila: Fila): EfectoDeDeshacer {
  return analizar(estado, fila).efecto
}

/** What a row needs before it can come back: the values it lacks, or null when its option is gone (that row is asked alone). */
function necesidad(estado: VariantesState, fila: Fila): string | null {
  const previos = fila.previos ?? []
  const faltan: string[] = []
  for (const p of previos) {
    const opcion = estado.opciones.find((o) => o.id === p.opcionId)
    if (!opcion) return null
    if (p.valorId !== null && opcion.valores.some((v) => v.id === p.valorId)) continue
    // The undo re-adds the value with the row's OWN snapshot text, so two rows that share a value id but were
    // archived under different names (a rename in between, even only in case) do not need the same thing.
    faltan.push(JSON.stringify([p.opcionId, p.valorId, p.valor.trim()]))
  }
  return faltan.sort().join("|")
}

/**
 * The preview of EVERY row pending archive, asking the reducer once per distinct need instead of once per row.
 * Rows that lack the same values get the same undo: the same values are added back and the same combinations
 * complete, so one run answers all of them (each one's "also comes back" list is the returned rows minus
 * itself). A row the shared run did not bring back, or whose option is gone, is asked on its own, so the
 * answer is always the one the row-by-row question gives (the tests compare them).
 */
export function efectosDeDeshacer(estado: VariantesState): Map<string, EfectoDeDeshacer> {
  const resultado = new Map<string, EfectoDeDeshacer>()
  const grupos = new Map<string, Fila[]>()
  const solas: Fila[] = []
  for (const fila of filasEnOrden(estado)) {
    if (!fila.archivar) continue
    const clave = necesidad(estado, fila)
    if (clave === null) solas.push(fila)
    else grupos.set(clave, [...(grupos.get(clave) ?? []), fila])
  }

  for (const fila of solas) resultado.set(fila.id, efectoDeDeshacer(estado, fila))
  for (const filas of grupos.values()) {
    const [primera, ...resto] = filas
    const base = analizar(estado, primera)
    resultado.set(primera.id, base.efecto)
    // A refusal that is not about one row's own combination is the same for the whole group.
    const compartida = base.efecto.bloqueo !== null && !base.efecto.bloqueo.startsWith("Ya hay una variante")
    const devueltas = new Set(base.devueltas.map((d) => d.id))
    for (const fila of resto) {
      if (compartida) resultado.set(fila.id, { ...base.efecto })
      else if (base.efecto.bloqueo === null && devueltas.has(fila.id)) {
        resultado.set(fila.id, { ...base.efecto, tambien: base.devueltas.filter((d) => d.id !== fila.id).map((d) => d.etiqueta) })
      } else resultado.set(fila.id, efectoDeDeshacer(estado, fila))
    }
  }
  return resultado
}

/** "a, b y c": the last one joined with "y". Used inside every clause and between the clauses. */
const unir = (partes: string[]) => (partes.length < 2 ? (partes[0] ?? "") : `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`)

/** The sentence for the row: null when the undo is just that row coming back. */
export function describirEfecto(efecto: EfectoDeDeshacer): string | null {
  if (efecto.bloqueo) return efecto.bloqueo
  const uno = (items: string[], singular: string, plural: string) => (items.length === 1 ? singular : plural)
  const partes: string[] = []
  if (efecto.valores.length > 0) partes.push(`${uno(efecto.valores, "se vuelve", "se vuelven")} a agregar ${unir(efecto.valores)}`)
  if (efecto.tambien.length > 0) partes.push(`también ${uno(efecto.tambien, "vuelve", "vuelven")} ${unir(efecto.tambien)}`)
  if (efecto.nuevas.length > 0) partes.push(`${uno(efecto.nuevas, "se agrega", "se agregan")} ${unir(efecto.nuevas)}`)
  if (efecto.restauradas.length > 0) partes.push(`${uno(efecto.restauradas, "se restaura", "se restauran")} ${unir(efecto.restauradas)}`)
  if (partes.length === 0) return null
  // A clause with a list of two or more already has a "y" inside: the clauses are then told apart with ";" and
  // the closing "y" goes only before the last clause, so "y" never reads as joining two different things.
  const hayListas = [efecto.valores, efecto.tambien, efecto.nuevas, efecto.restauradas].some((x) => x.length >= 2)
  if (hayListas && partes.length >= 2) return `Al deshacer ${partes.slice(0, -1).join("; ")}; y ${partes[partes.length - 1]}`
  return `Al deshacer ${unir(partes)}`
}

export interface Validez {
  valida: boolean
  /** What stops the save, in the words the user reads. */
  motivos: string[]
}

/**
 * Whether the variants can be saved as they are. The form disables Save with this; the section lists the
 * reasons. A product without variants (switch off) has nothing to validate. Reserved units on a row
 * pending archive come from `bloqueos`, so the reason is the reducer's.
 */
export function validezDeVariantes(estado: VariantesState): Validez {
  if (!estado.activo) return { valida: true, motivos: [] }
  const activas = filasEnOrden(estado).filter((f) => !f.archivar)
  if (activas.length === 0) {
    return { valida: false, motivos: ["Agregá una opción (por ejemplo Color) con al menos un valor para armar las variantes"] }
  }

  const motivos = bloqueos(estado).map((b) => b.motivo)
  for (const fila of activas) {
    if (!fila.existente && fila.codigo.trim() === "") motivos.push(`Falta el código de "${etiquetaDeFila(estado, fila)}"`)
  }
  const vistos = new Map<string, { codigo: string; veces: number }>()
  for (const fila of activas) {
    const codigo = fila.codigo.trim()
    if (codigo === "") continue
    const clave = codigo.toLowerCase()
    const visto = vistos.get(clave)
    if (visto) visto.veces++
    else vistos.set(clave, { codigo, veces: 1 })
  }
  for (const { codigo, veces } of vistos.values()) {
    if (veces > 1) motivos.push(`El código "${codigo}" está repetido`)
  }
  return { valida: motivos.length === 0, motivos }
}
