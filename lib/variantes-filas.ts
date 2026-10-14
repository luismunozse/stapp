import type { AtributoVariante } from "@/types"
import { claveCombinacion, etiquetaVariante } from "@/lib/variantes"
import { LIMITES, redondearPrecio } from "@/lib/variantes-schema"

// PURE and client-importable: no I/O, no React, no server-only imports. The state of the
// variants section of the product form (rows keyed by child id) and the pure functions
// that derive from it: a reducer, selectors and the code generator. Photo files and blob
// URLs never enter this state (they live in the photo hook), so the draft can serialize it.

// ---------------------------------------------------------------------------------------
// Code generator
// ---------------------------------------------------------------------------------------

const MAX_LETRAS_PALABRA_UNICA = 3
const MAX_DIGITOS = 4

/** Letters and digits only, in ASCII: accents and n-tilde fold to their base letter. */
function palabrasAscii(valor: string): string[] {
  const plano = valor.normalize("NFD").replace(/\p{M}/gu, "")
  return plano.match(/[A-Za-z0-9]+/g) ?? []
}

const esNumero = (palabra: string) => /^[0-9]+$/.test(palabra)

/** The first `max` code points: a UTF-16 slice could leave half of an emoji. The cap counts characters, like the database. */
const cortar = (texto: string, max: number) => Array.from(texto).slice(0, max).join("")

/**
 * Short ASCII tag of one value: "Rojo" -> ROJ, "Azul marino" -> AM, "128 GB" -> 128G, "M" -> M.
 * One word keeps three letters (so Rojo and Rosado differ); several words keep the initials and
 * any number whole. A value with nothing ASCII to keep becomes X.
 */
function abreviar(valor: string): string {
  const palabras = palabrasAscii(valor).map((p) => p.toUpperCase())
  if (palabras.length === 0) return "X"
  if (palabras.length === 1) {
    const [unica] = palabras
    return esNumero(unica) ? unica.slice(0, MAX_DIGITOS) : unica.slice(0, MAX_LETRAS_PALABRA_UNICA)
  }
  return palabras.map((p) => (esNumero(p) ? p.slice(0, MAX_DIGITOS) : p[0])).join("")
}

/**
 * Editable auto code of a combination: "{base code}-{abbreviation of each value}". Deterministic.
 * A code already in `usados` (compared ignoring case) gets the first free numeric suffix: -2, -3...
 * The result never exceeds the code cap: an over-long base is cut, never the tag or the suffix.
 */
export function generarCodigoVariante(base: string, valores: readonly string[], usados: Iterable<string>): string {
  const ocupados = new Set(Array.from(usados, (c) => c.toLowerCase()))
  const prefijo = base.trim()
  const etiqueta = valores.map(abreviar).join("-")

  const armar = (sufijoNumerico: string) => {
    const cola = [etiqueta, sufijoNumerico].filter((p) => p !== "").join("-")
    if (cola === "") return cortar(prefijo, LIMITES.codigo)
    if (prefijo === "") return cortar(cola, LIMITES.codigo)
    const espacio = Math.max(0, LIMITES.codigo - cola.length - 1)
    return cortar(`${cortar(prefijo, espacio)}-${cola}`, LIMITES.codigo)
  }

  let candidato = armar("")
  for (let n = 2; ocupados.has(candidato.toLowerCase()); n++) candidato = armar(String(n))
  return candidato
}

// ---------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------

export interface ValorDeOpcion {
  id: string
  texto: string
}

export interface OpcionDeEstado {
  id: string
  nombre: string
  valores: ValorDeOpcion[]
}

export interface FilaExtra {
  stockMinimo: number | null
  stockMaximo: number | null
  puntoReorden: number | null
  ubicacion: string | null
}

/**
 * One attribute of a combination as it was when the row left the active ones. The ids resolve later
 * renames; the text is the fallback for a value or option that no longer exists. The ids are null for
 * a child archived in the database whose value is not among the options.
 */
export interface PrevioDeFila {
  opcionId: string | null
  valorId: string | null
  opcion: string
  valor: string
}

/** One combination of the group. The key of `filas` is the child id (client-generated for a new row). */
export interface Fila {
  id: string
  /** One value id per option that has values, in option order. Empty while the row is pending archive. */
  valorIds: string[]
  /** Saved in the database (hydrated, or restored from the archive). */
  existente: boolean
  /** Will be archived on save ("Se archivará"). It keeps its place but is out of the combinations. */
  archivar: boolean
  /**
   * The combination it had when it was marked, so undo and re-adding can find it again. Only while `archivar`.
   * It holds ids: a later rename of an option or a value cannot detach the row from its combination.
   */
  previos?: PrevioDeFila[]
  /**
   * Brought back from the archive: the client never saw its code, price or cost, so `codigo` is ""
   * and the base price does not reach it. The form must send those fields only once the user edits them.
   */
  restaurada?: boolean
  codigo: string
  codigoTocado: boolean
  barcode: string | null
  precioVenta: number
  precioTocado: boolean
  /** Absent when the role has no cost access. */
  precioCompra?: number
  /** Initial stock of a NEW row. Ignored for a saved row. */
  stockInicial: number
  /** Saved stock of an existing row (read-only in the form). */
  stock?: number
  stockReservado?: number
  /** The row's OWN saved photo. Read-only here: photos are staged outside the reducer. */
  imagenUrl: string | null
  extra: FilaExtra
}

export interface VariantesState {
  activo: boolean
  grupoId: string
  /** Standalone item being turned into the first combination, if any. */
  promocionId: string | null
  /** Code of the product, the prefix of the generated codes. */
  codigoBase: string
  precioBase: number
  costoBase: number
  /** False for a role without cost access: no row carries `precioCompra`. */
  costoCargado: boolean
  /** The reason the last action was refused, or null. */
  aviso: string | null
  opciones: OpcionDeEstado[]
  filas: Record<string, Fila>
  /** Row ids: the combinations in option order then value order, then the rows pending archive. */
  orden: string[]
  /** Children archived in the database, by id, with the combination they had (as ids where the options know them). */
  archivadas: Record<string, { previos: PrevioDeFila[]; stock: number }>
  /** Random, set once when the state is born (never inside the reducer). Every id minted later derives from it. */
  semilla: string
  /** How many ids were minted from `semilla`. The next id is hash(semilla, contador). */
  contador: number
}

// Ids come from (semilla, contador) so that the reducer is a pure function of (state, action): the same
// action on the same state gives the same state, ids included (React may replay a reducer). The hash is
// cyrb128 (public domain), 128 bits of state of which 96 are used: a client id is "c" + 24 hex.
function hashDeId(texto: string): string {
  let h1 = 1779033703
  let h2 = 3144134277
  let h3 = 1013904242
  let h4 = 2773480762
  for (let i = 0; i < texto.length; i++) {
    const k = texto.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
  h1 ^= h2 ^ h3 ^ h4
  h2 ^= h1
  h3 ^= h1
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0")
  return "c" + hex(h1) + hex(h2) + hex(h3)
}

/** A fresh random seed. Call it when a state is created, never from a reducer. */
function semillaAleatoria(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("")
}

/** Mints ids from a seed and a counter; `contador` is where it stands. Local to one reducer call or one hydration. */
function acuniador(semilla: string, desde: number) {
  const a = { contador: desde, siguiente: () => hashDeId(`${semilla}:${a.contador++}`) }
  return a
}

export interface ParametrosEstadoInicial {
  grupoId: string
  /** Fixes the ids (tests). By default a random seed is drawn. */
  semilla?: string
  codigoBase?: string
  precioBase?: number
  costoBase?: number
  costoCargado?: boolean
}

export function estadoInicial(p: ParametrosEstadoInicial): VariantesState {
  return {
    activo: false,
    grupoId: p.grupoId,
    promocionId: null,
    codigoBase: p.codigoBase ?? "",
    precioBase: p.precioBase ?? 0,
    costoBase: p.costoBase ?? 0,
    costoCargado: p.costoCargado ?? false,
    aviso: null,
    opciones: [],
    filas: {},
    orden: [],
    archivadas: {},
    semilla: p.semilla ?? semillaAleatoria(),
    contador: 0,
  }
}

// ---------------------------------------------------------------------------------------
// Hydration from GET /api/inventario/grupos/[id]
// ---------------------------------------------------------------------------------------

export interface VarianteLeida {
  id: string
  atributos: AtributoVariante[] | null
  codigo: string
  barcode?: string | null
  precioVenta: number
  precioCompra?: number | null
  stock: number
  stockReservado?: number | null
  stockMinimo?: number | null
  stockMaximo?: number | null
  puntoReorden?: number | null
  ubicacion?: string | null
  imagenUrl?: string | null
}

export interface GrupoLeido {
  grupo: { id: string; nombre: string; opciones: { nombre: string; valores: string[] }[] }
  variantes: VarianteLeida[]
  archivadas: { id: string; atributos: AtributoVariante[] | null; stock: number }[]
}

export interface OpcionesHidratacion {
  costoCargado: boolean
  /** Fixes the ids (tests). By default a random seed is drawn. */
  semilla?: string
  codigoBase?: string
  precioBase?: number
  costoBase?: number
}

const SEPARADOR = String.fromCharCode(31)
const NUL = String.fromCharCode(0)

/** The text folded the way the database folds a combination value (case, accents, edge whitespace). */
const plegar = (texto: string) => claveCombinacion([{ opcion: "", valor: texto }])

const longitud = (s: string) => Array.from(s).length

/** A saved photo URL only: a blob: or data: URL is local content and never belongs in the state. */
function urlGuardada(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null
  const limpia = url.trim()
  return limpia === "" || /^(blob|data):/i.test(limpia) ? null : limpia
}

const sinExtra = (): FilaExtra => ({ stockMinimo: null, stockMaximo: null, puntoReorden: null, ubicacion: null })

/** Builds the state of an existing group. Option and value ids are internal keys, minted here. */
export function estadoDesdeGrupo(lectura: GrupoLeido, opts: OpcionesHidratacion): VariantesState {
  const semilla = opts.semilla ?? semillaAleatoria()
  const acuniar = acuniador(semilla, 0)
  const generarId = acuniar.siguiente
  const opciones: OpcionDeEstado[] = lectura.grupo.opciones.map((o) => ({
    id: generarId(),
    nombre: o.nombre,
    valores: o.valores.map((texto) => ({ id: generarId(), texto })),
  }))

  const valorDe = (atributo: AtributoVariante): { opcionIdx: number; valorId: string } | null => {
    const opcionIdx = opciones.findIndex((o) => plegar(o.nombre) === plegar(atributo.opcion))
    if (opcionIdx === -1) return null
    const opcion = opciones[opcionIdx]
    let valor = opcion.valores.find((v) => plegar(v.texto) === plegar(atributo.valor))
    if (!valor) {
      // Data the group options do not list: keep the row representable.
      valor = { id: generarId(), texto: atributo.valor }
      opcion.valores.push(valor)
    }
    return { opcionIdx, valorId: valor.id }
  }

  const filas: Record<string, Fila> = {}
  for (const v of lectura.variantes) {
    const ids = (v.atributos ?? []).flatMap((a) => {
      const hallado = valorDe(a)
      return hallado ? [hallado] : []
    })
    const fila: Fila = {
      id: v.id,
      valorIds: ids.sort((a, b) => a.opcionIdx - b.opcionIdx).map((x) => x.valorId),
      existente: true,
      archivar: false,
      codigo: v.codigo,
      codigoTocado: true,
      barcode: v.barcode && v.barcode.trim() !== "" ? v.barcode : null,
      precioVenta: v.precioVenta,
      precioTocado: true,
      stockInicial: 0,
      stock: v.stock,
      stockReservado: v.stockReservado ?? 0,
      imagenUrl: urlGuardada(v.imagenUrl),
      extra: {
        stockMinimo: v.stockMinimo ?? null,
        stockMaximo: v.stockMaximo ?? null,
        puntoReorden: v.puntoReorden ?? null,
        ubicacion: v.ubicacion ?? null,
      },
    }
    if (opts.costoCargado && typeof v.precioCompra === "number") fila.precioCompra = v.precioCompra
    filas[v.id] = fila
  }

  const archivadas: VariantesState["archivadas"] = {}
  for (const a of lectura.archivadas) {
    if (a.atributos && a.atributos.length > 0) archivadas[a.id] = { previos: a.atributos.map((x) => previoDeAtributo(opciones, x)), stock: a.stock }
  }

  const primera = lectura.variantes[0]
  const estado: VariantesState = {
    activo: true,
    grupoId: lectura.grupo.id,
    promocionId: null,
    codigoBase: opts.codigoBase ?? "",
    precioBase: opts.precioBase ?? primera?.precioVenta ?? 0,
    costoBase: opts.costoBase ?? 0,
    costoCargado: opts.costoCargado,
    aviso: null,
    opciones,
    filas,
    orden: [],
    archivadas,
    semilla,
    contador: acuniar.contador,
  }
  return { ...estado, orden: calcularOrden(estado) }
}

// ---------------------------------------------------------------------------------------
// Derived data
// ---------------------------------------------------------------------------------------

interface Ubicacion {
  opcionIdx: number
  valorIdx: number
  opcionId: string
  opcion: string
  texto: string
}

function indiceDeValores(opciones: readonly OpcionDeEstado[]): Map<string, Ubicacion> {
  const indice = new Map<string, Ubicacion>()
  opciones.forEach((o, opcionIdx) =>
    o.valores.forEach((v, valorIdx) => indice.set(v.id, { opcionIdx, valorIdx, opcionId: o.id, opcion: o.nombre, texto: v.texto }))
  )
  return indice
}

/** An attribute of a child read from the database, tied to the option and value ids that already exist. */
function previoDeAtributo(opciones: readonly OpcionDeEstado[], atributo: AtributoVariante): PrevioDeFila {
  const opcion = opciones.find((o) => plegar(o.nombre) === plegar(atributo.opcion))
  const valor = opcion?.valores.find((v) => plegar(v.texto) === plegar(atributo.valor))
  return { opcionId: opcion?.id ?? null, valorId: valor?.id ?? null, opcion: atributo.opcion, valor: atributo.valor }
}

/** What a snapshot reads as NOW: renamed options and values show their current text; gone ones keep the old one. */
function atributosActuales(estado: VariantesState, previos: readonly PrevioDeFila[]): AtributoVariante[] {
  const indice = indiceDeValores(estado.opciones)
  return previos.map((p) => ({
    opcion: estado.opciones.find((o) => o.id === p.opcionId)?.nombre ?? p.opcion,
    valor: (p.valorId ? indice.get(p.valorId)?.texto : undefined) ?? p.valor,
  }))
}

/** The combination of a row as {opcion, valor} pairs in option order. */
function atributosDe(estado: VariantesState, fila: Fila): AtributoVariante[] {
  if (fila.archivar) return atributosActuales(estado, fila.previos ?? [])
  const indice = indiceDeValores(estado.opciones)
  return fila.valorIds
    .flatMap((id) => {
      const u = indice.get(id)
      return u ? [u] : []
    })
    .sort((a, b) => a.opcionIdx - b.opcionIdx)
    .map((u) => ({ opcion: u.opcion, valor: u.texto }))
}

/** "Rojo / M": what the row is called in the form. */
export function etiquetaDeFila(estado: VariantesState, fila: Fila): string {
  return etiquetaVariante(atributosDe(estado, fila)) ?? ""
}

function rangoDe(fila: Fila, indice: Map<string, Ubicacion>): number[] {
  return fila.valorIds
    .flatMap((id) => {
      const u = indice.get(id)
      return u ? [u] : []
    })
    .sort((a, b) => a.opcionIdx - b.opcionIdx)
    .map((u) => u.valorIdx)
}

function compararRangos(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return a.length - b.length
}

/** Combinations in option order then value order, then the rows pending archive in the order they had. */
function calcularOrden(estado: VariantesState, previo: readonly string[] = []): string[] {
  const indice = indiceDeValores(estado.opciones)
  const posicion = new Map(previo.map((id, i) => [id, i]))
  const lugar = (id: string) => posicion.get(id) ?? previo.length
  const todas = Object.values(estado.filas)
  const activas = todas
    .filter((f) => !f.archivar)
    .map((f) => ({ f, rango: rangoDe(f, indice) }))
    .sort((a, b) => compararRangos(a.rango, b.rango) || lugar(a.f.id) - lugar(b.f.id))
    .map(({ f }) => f.id)
  const archivadas = todas
    .filter((f) => f.archivar)
    .sort((a, b) => lugar(a.id) - lugar(b.id))
    .map((f) => f.id)
  return [...activas, ...archivadas]
}

const reordenar = (estado: VariantesState): VariantesState => ({ ...estado, orden: calcularOrden(estado, estado.orden) })

export const filasEnOrden = (estado: VariantesState): Fila[] => estado.orden.map((id) => estado.filas[id])

/** What the product holds in total: saved stock of the rows plus the initial stock of the new ones. Rows pending archive do not count. */
export function stockTotal(estado: VariantesState): number {
  return filasEnOrden(estado)
    .filter((f) => !f.archivar)
    .reduce((suma, f) => suma + (f.existente ? (f.stock ?? 0) : f.stockInicial), 0)
}

export interface BloqueoDeArchivo {
  filaId: string
  etiqueta: string
  unidades: number
  motivo: string
}

/** Rows pending archive that still have reserved units: the form cannot save while any exists. */
export function bloqueos(estado: VariantesState): BloqueoDeArchivo[] {
  return filasEnOrden(estado)
    .filter((f) => f.archivar && (f.stockReservado ?? 0) > 0)
    .map((f) => {
      const unidades = f.stockReservado ?? 0
      const etiqueta = etiquetaDeFila(estado, f)
      const reservadas = unidades === 1 ? "1 unidad reservada" : `${unidades} unidades reservadas`
      return { filaId: f.id, etiqueta, unidades, motivo: `No se puede archivar "${etiqueta}": tiene ${reservadas}` }
    })
}

export interface ArchivoConStock {
  filaId: string
  etiqueta: string
  stock: number
}

/** Rows pending archive that hold stock (and nothing reserved): the form asks before saving them. */
export function archivosConStock(estado: VariantesState): ArchivoConStock[] {
  return filasEnOrden(estado)
    .filter((f) => f.archivar && f.existente && (f.stock ?? 0) > 0 && (f.stockReservado ?? 0) === 0)
    .map((f) => ({ filaId: f.id, etiqueta: etiquetaDeFila(estado, f), stock: f.stock ?? 0 }))
}

// ---------------------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------------------

export type VariantesAccion =
  | { tipo: "reemplazar"; estado: VariantesState }
  | { tipo: "activar" }
  | { tipo: "desactivar" }
  | { tipo: "agregarOpcion"; nombre: string; valores?: readonly string[] }
  | { tipo: "renombrarOpcion"; opcionId: string; nombre: string }
  | { tipo: "quitarOpcion"; opcionId: string }
  | { tipo: "agregarValor"; opcionId: string; texto: string }
  /** A list of values (a paste): applied in order over the latest state; the refused ones are reported together. */
  | { tipo: "agregarValores"; opcionId: string; textos: readonly string[] }
  | { tipo: "renombrarValor"; valorId: string; texto: string }
  | { tipo: "quitarValor"; valorId: string }
  | { tipo: "deshacerArchivo"; filaId: string }
  | { tipo: "cambiarCodigoBase"; codigo: string }
  | { tipo: "cambiarPrecioBase"; precio: number }
  | { tipo: "cambiarCostoBase"; costo: number }
  | { tipo: "aplicarPrecioATodas" }
  | { tipo: "editarFila"; filaId: string; cambios: CambiosDeFila }
  | { tipo: "promover"; item: ItemPromovido; filaId?: string }

/** What the form can type into a row. Stock, photo and ids are not here on purpose. */
export interface CambiosDeFila {
  codigo?: string
  barcode?: string | null
  precioVenta?: number
  /** Ignored without cost access. */
  precioCompra?: number
  /** New rows only; ignored on a saved row. */
  stockInicial?: number
  stockMinimo?: number | null
  stockMaximo?: number | null
  puntoReorden?: number | null
  ubicacion?: string | null
}

/** A standalone item being turned into the first combination (the data the form already loaded). */
export type ItemPromovido = Omit<VarianteLeida, "atributos">

export type Reductor = (estado: VariantesState, accion: VariantesAccion) => VariantesState

/** A step either gives the next state or the reason it was refused. */
type Resultado = VariantesState | string

const NO_ADMITIDO = "Hay un texto con un carácter que no se admite"

function validarValor(crudo: string): { texto: string } | { aviso: string } {
  const texto = crudo.trim()
  if (texto === "") return { aviso: "Los valores no pueden estar vacíos" }
  if (longitud(texto) > LIMITES.valor) return { aviso: "Cada valor puede tener hasta 100 caracteres" }
  if (texto.includes(SEPARADOR) || texto.includes(NUL)) return { aviso: "Hay un valor con un carácter que no se admite" }
  return { texto }
}

function validarNombreOpcion(crudo: string): { texto: string } | { aviso: string } {
  const texto = crudo.trim()
  if (texto === "") return { aviso: "Cada opción necesita un nombre" }
  if (longitud(texto) > LIMITES.nombreOpcion) return { aviso: "El nombre de una opción puede tener hasta 100 caracteres" }
  if (texto.includes(NUL)) return { aviso: NO_ADMITIDO }
  return { texto }
}

/** How many rows the options generate. Options without values do not take part. */
function totalDeCombinaciones(opciones: readonly OpcionDeEstado[]): number {
  const conValores = opciones.filter((o) => o.valores.length > 0)
  return conValores.length === 0 ? 0 : conValores.reduce((total, o) => total * o.valores.length, 1)
}

function producto(opciones: readonly OpcionDeEstado[]): ValorDeOpcion[][] {
  return opciones.reduce<ValorDeOpcion[][]>((acumulado, o) => acumulado.flatMap((prefijo) => o.valores.map((v) => [...prefijo, v])), [[]])
}

function ordenarIds(ids: readonly string[], indice: Map<string, Ubicacion>): string[] {
  return [...ids].sort((a, b) => (indice.get(a)?.opcionIdx ?? 0) - (indice.get(b)?.opcionIdx ?? 0))
}

function filaNueva(estado: VariantesState, id: string, valorIds: string[], codigo: string): Fila {
  const fila: Fila = {
    id,
    valorIds,
    existente: false,
    archivar: false,
    codigo,
    codigoTocado: false,
    barcode: null,
    precioVenta: estado.precioBase,
    precioTocado: false,
    stockInicial: 0,
    imagenUrl: null,
    extra: sinExtra(),
  }
  if (estado.costoCargado) fila.precioCompra = estado.costoBase
  return fila
}

/** The client never saw the cost of an archived child: the key stays absent until the user types one. */
function filaRestaurada(estado: VariantesState, id: string, valorIds: string[], stock: number): Fila {
  const fila: Fila = { ...filaNueva(estado, id, valorIds, ""), existente: true, restaurada: true, stock, stockReservado: 0 }
  delete fila.precioCompra
  return fila
}

function archivarFila(estado: VariantesState, fila: Fila): Fila {
  const indice = indiceDeValores(estado.opciones)
  const previos = fila.valorIds
    .flatMap((id) => {
      const u = indice.get(id)
      return u ? [{ id, u }] : []
    })
    .sort((a, b) => a.u.opcionIdx - b.u.opcionIdx)
    .map(({ id, u }) => ({ opcionId: u.opcionId, valorId: id, opcion: u.opcion, valor: u.texto }))
  return { ...fila, archivar: true, valorIds: [], previos }
}

/** Creates the rows the options ask for and no row has yet, reusing archived ones for the same combination. */
function completar(estado: VariantesState, generarId: () => string): VariantesState {
  const conValores = estado.opciones.filter((o) => o.valores.length > 0)
  if (conValores.length === 0) return reordenar(estado)

  const filas = { ...estado.filas }
  const archivadas = { ...estado.archivadas }
  const ocupadas = new Set(Object.values(filas).filter((f) => !f.archivar).map((f) => f.valorIds.join(SEPARADOR)))
  const usados = Object.values(filas).map((f) => f.codigo).filter((c) => c !== "")

  for (const combinacion of producto(conValores)) {
    const valorIds = combinacion.map((v) => v.id)
    if (ocupadas.has(valorIds.join(SEPARADOR))) continue
    const atributos = combinacion.map((v, i) => ({ opcion: conValores[i].nombre, valor: v.texto }))
    const clave = claveCombinacion(atributos)

    // A snapshot reads through the ids, so a rename since the row was archived still matches.
    const esDeLaCombinacion = (previos: readonly PrevioDeFila[]) => claveCombinacion(atributosActuales(estado, previos)) === clave
    const pendiente = Object.values(filas).find((f) => f.archivar && f.previos && esDeLaCombinacion(f.previos))
    if (pendiente) {
      const { previos: _previos, ...resto } = pendiente
      void _previos
      filas[pendiente.id] = { ...resto, archivar: false, valorIds }
      continue
    }
    const guardada = Object.entries(archivadas).find(([, a]) => esDeLaCombinacion(a.previos))
    if (guardada) {
      const [id, { stock }] = guardada
      filas[id] = filaRestaurada(estado, id, valorIds, stock)
      delete archivadas[id]
      continue
    }
    const id = generarId()
    const codigo = generarCodigoVariante(estado.codigoBase, combinacion.map((v) => v.texto), usados)
    usados.push(codigo)
    filas[id] = filaNueva(estado, id, valorIds, codigo)
  }
  return reordenar({ ...estado, filas, archivadas })
}

/** The first value of an option joins every row, so the rows keep their ids instead of being recreated. */
function extenderFilas(estado: VariantesState, valorId: string): VariantesState {
  const indice = indiceDeValores(estado.opciones)
  const filas = Object.fromEntries(
    Object.entries(estado.filas).map(([id, f]) => [id, f.archivar ? f : { ...f, valorIds: ordenarIds([...f.valorIds, valorId], indice) }])
  )
  return { ...estado, filas }
}

/**
 * A dimension disappears (an option was removed, or its last value): rows that now share a combination
 * collapse. A saved row survives first (in a new group that is the promoted item), then the first row. Other
 * saved rows are archived; the others are dropped.
 */
function colapsar(estado: VariantesState, quitar: ReadonlySet<string>, opciones: OpcionDeEstado[]): VariantesState {
  const filas = { ...estado.filas }
  const grupos = new Map<string, Fila[]>()
  for (const fila of filasEnOrden(estado).filter((f) => !f.archivar)) {
    const clave = fila.valorIds.filter((id) => !quitar.has(id)).join(SEPARADOR)
    grupos.set(clave, [...(grupos.get(clave) ?? []), fila])
  }
  for (const miembros of grupos.values()) {
    const sobreviviente = miembros.find((f) => f.existente) ?? miembros[0]
    filas[sobreviviente.id] = { ...sobreviviente, valorIds: sobreviviente.valorIds.filter((id) => !quitar.has(id)) }
    for (const otra of miembros) {
      if (otra.id === sobreviviente.id) continue
      if (otra.existente) filas[otra.id] = archivarFila(estado, otra)
      else delete filas[otra.id]
    }
  }
  return rederivarCodigos(reordenar({ ...estado, opciones, filas }))
}

/** New rows still on their generated code follow the texts; saved or hand-edited codes stay. */
function rederivarCodigos(estado: VariantesState): VariantesState {
  // A saved row (restored ones included) never follows the text; a new row is never pending archive.
  const objetivos = estado.orden.filter((id) => !estado.filas[id].existente && !estado.filas[id].codigoTocado)
  const seleccion = new Set(objetivos)
  const usados = Object.values(estado.filas).filter((f) => !seleccion.has(f.id)).map((f) => f.codigo).filter((c) => c !== "")
  const filas = { ...estado.filas }
  for (const id of objetivos) {
    const fila = filas[id]
    const textos = atributosDe(estado, fila).map((a) => a.valor)
    const codigo = generarCodigoVariante(estado.codigoBase, textos, usados)
    usados.push(codigo)
    filas[id] = { ...fila, codigo }
  }
  return { ...estado, filas }
}

/** `idForzado` brings back a value under the id the archived rows remember. */
function agregarValor(estado: VariantesState, opcionId: string, crudo: string, generarId: () => string, idForzado?: string): Resultado {
  const idx = estado.opciones.findIndex((o) => o.id === opcionId)
  if (idx === -1) return estado
  const validado = validarValor(crudo)
  if ("aviso" in validado) return validado.aviso
  const opcion = estado.opciones[idx]
  if (opcion.valores.length >= LIMITES.valoresPorOpcion) return "Una opción puede tener hasta 100 valores"
  const clave = plegar(validado.texto)
  if (opcion.valores.some((v) => plegar(v.texto) === clave)) return `El valor "${validado.texto}" está repetido en ${opcion.nombre}`

  const valor: ValorDeOpcion = { id: idForzado ?? generarId(), texto: validado.texto }
  const opciones = estado.opciones.map((o, i) => (i === idx ? { ...o, valores: [...o.valores, valor] } : o))
  const combinaciones = totalDeCombinaciones(opciones)
  if (combinaciones > LIMITES.combinaciones) return `Las opciones generan ${combinaciones} combinaciones y el máximo es 100`

  const siguiente = { ...estado, opciones }
  if (opcion.valores.length > 0) return completar(siguiente, generarId)
  // The rows gain a value: their generated codes gain its tag.
  return rederivarCodigos(completar(extenderFilas(siguiente, valor.id), generarId))
}

/** Up to this many refused values are named; more are only counted. */
const MAX_NOMBRADOS = 5

/**
 * One message for the refused values of a paste. The same reason for several values is said once ("No se
 * agregaron "a" y "b": reason"; just "No se agregaron 7 valores: reason" past five); a reason that already
 * names its value stands alone. Reasons keep the order in which they first appear.
 */
function avisoDeRechazos(rechazos: readonly { texto: string; motivo: string }[]): string {
  const porMotivo = new Map<string, string[]>()
  for (const { texto, motivo } of rechazos) {
    const textos = porMotivo.get(motivo) ?? []
    if (!textos.includes(texto)) textos.push(texto)
    porMotivo.set(motivo, textos)
  }
  const frases: string[] = []
  for (const [motivo, textos] of porMotivo) {
    if (textos.length === 1) {
      frases.push(motivo.includes(`"${textos[0]}"`) ? motivo : `No se agregó "${textos[0]}": ${motivo}`)
    } else if (textos.length > MAX_NOMBRADOS) {
      frases.push(`No se agregaron ${textos.length} valores: ${motivo}`)
    } else {
      const nombres = textos.map((x) => `"${x}"`)
      frases.push(`No se agregaron ${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}: ${motivo}`)
    }
  }
  return frases.join("; ")
}

/**
 * Several values at once, in order. Every accepted value stays; every refusal is collected into ONE message
 * (the reason alone when it already names the value, else prefixed with it). Nothing accepted: the same state
 * plus the message, and the counter does not move. Ids come from the state's own seed and counter, advanced
 * only by the values that were accepted, so the result is a pure function of (state, action).
 */
function agregarValores(estado: VariantesState, opcionId: string, textos: readonly string[]): VariantesState {
  let actual = estado
  let contador = estado.contador
  const rechazos: { texto: string; motivo: string }[] = []
  for (const texto of textos) {
    const acuniar = acuniador(estado.semilla, contador)
    const siguiente = agregarValor(actual, opcionId, texto, acuniar.siguiente)
    if (typeof siguiente === "string") {
      rechazos.push({ texto: texto.trim(), motivo: siguiente })
      continue
    }
    if (siguiente !== actual) contador = acuniar.contador
    actual = siguiente
  }
  const aviso = rechazos.length > 0 ? avisoDeRechazos(rechazos) : null
  if (actual === estado) return aviso === null ? estado : { ...estado, aviso }
  return { ...actual, aviso, contador }
}

function agregarOpcion(estado: VariantesState, nombreCrudo: string, valores: readonly string[], generarId: () => string): Resultado {
  const validado = validarNombreOpcion(nombreCrudo)
  if ("aviso" in validado) return validado.aviso
  if (estado.opciones.length >= LIMITES.opciones) return "Un producto puede tener hasta 3 opciones"
  if (estado.opciones.some((o) => plegar(o.nombre) === plegar(validado.texto))) return "Las opciones no pueden repetirse"

  const opcion: OpcionDeEstado = { id: generarId(), nombre: validado.texto, valores: [] }
  let actual: Resultado = { ...estado, opciones: [...estado.opciones, opcion] }
  for (const texto of valores) {
    actual = agregarValor(actual, opcion.id, texto, generarId)
    if (typeof actual === "string") return actual
  }
  return actual
}

function renombrarOpcion(estado: VariantesState, opcionId: string, nombreCrudo: string): Resultado {
  const opcion = estado.opciones.find((o) => o.id === opcionId)
  if (!opcion) return estado
  const validado = validarNombreOpcion(nombreCrudo)
  if ("aviso" in validado) return validado.aviso
  if (estado.opciones.some((o) => o.id !== opcionId && plegar(o.nombre) === plegar(validado.texto))) return "Las opciones no pueden repetirse"

  // Rows pending archive and archived children point at the option by id: nothing else to update.
  return { ...estado, opciones: estado.opciones.map((o) => (o.id === opcionId ? { ...o, nombre: validado.texto } : o)) }
}

function quitarOpcion(estado: VariantesState, opcionId: string): Resultado {
  const opcion = estado.opciones.find((o) => o.id === opcionId)
  if (!opcion) return estado
  return colapsar(estado, new Set(opcion.valores.map((v) => v.id)), estado.opciones.filter((o) => o.id !== opcionId))
}

function renombrarValor(estado: VariantesState, valorId: string, crudo: string): Resultado {
  const opcion = estado.opciones.find((o) => o.valores.some((v) => v.id === valorId))
  if (!opcion) return estado
  const validado = validarValor(crudo)
  if ("aviso" in validado) return validado.aviso
  const clave = plegar(validado.texto)
  if (opcion.valores.some((v) => v.id !== valorId && plegar(v.texto) === clave)) return `El valor "${validado.texto}" está repetido en ${opcion.nombre}`

  const opciones = estado.opciones.map((o) =>
    o.id === opcion.id ? { ...o, valores: o.valores.map((v) => (v.id === valorId ? { ...v, texto: validado.texto } : v)) } : o
  )
  return rederivarCodigos({ ...estado, opciones })
}

function quitarValor(estado: VariantesState, valorId: string): Resultado {
  const opcion = estado.opciones.find((o) => o.valores.some((v) => v.id === valorId))
  if (!opcion) return estado
  const promovida = estado.promocionId ? estado.filas[estado.promocionId] : undefined
  if (promovida?.valorIds.includes(valorId)) {
    const texto = opcion.valores.find((v) => v.id === valorId)?.texto ?? ""
    return `El producto que estás convirtiendo tiene que quedar en una combinación: elegí otra antes de quitar "${texto}"`
  }
  const opciones = estado.opciones.map((o) => (o.id === opcion.id ? { ...o, valores: o.valores.filter((v) => v.id !== valorId) } : o))
  if (opcion.valores.length === 1) return colapsar(estado, new Set([valorId]), opciones)

  const filas = { ...estado.filas }
  for (const fila of Object.values(estado.filas)) {
    if (fila.archivar || !fila.valorIds.includes(valorId)) continue
    if (fila.existente) filas[fila.id] = archivarFila(estado, fila)
    else delete filas[fila.id]
  }
  // A suffix a dropped row forced on another one is free again.
  return rederivarCodigos(reordenar({ ...estado, opciones, filas }))
}

function deshacerArchivo(estado: VariantesState, filaId: string, generarId: () => string): Resultado {
  const fila = estado.filas[filaId]
  if (!fila || !fila.archivar) return estado

  let actual: VariantesState = estado
  for (const previo of fila.previos ?? []) {
    // By id: a rename of the option or of any value since the row was archived changes nothing here.
    const opcion = actual.opciones.find((o) => o.id === previo.opcionId)
    if (!opcion) return `Para deshacerlo, volvé a agregar la opción "${previo.opcion}"`
    if (previo.valorId && opcion.valores.some((v) => v.id === previo.valorId)) continue
    const agregado = agregarValor(actual, opcion.id, previo.valor, generarId, previo.valorId ?? undefined)
    if (typeof agregado === "string") return agregado
    actual = agregado
  }
  actual = completar(actual, generarId)
  if (actual.filas[filaId]?.archivar) return `Ya hay una variante con la combinación "${etiquetaDeFila(estado, fila)}"`
  return actual
}

type Validado<T> = { valor: T } | { aviso: string }

/** A price or a cost: finite, not negative, at most the RPC cap, rounded to cents like a person would. */
function validarMonto(n: number, sustantivo: "precio" | "costo"): Validado<number> {
  if (typeof n !== "number" || !Number.isFinite(n)) return { aviso: `El ${sustantivo} tiene que ser un número` }
  if (n < 0) return { aviso: `El ${sustantivo} no puede ser negativo` }
  const redondeado = redondearPrecio(n)
  if (redondeado > LIMITES.precioMax) return { aviso: `El ${sustantivo} es demasiado grande` }
  return { valor: redondeado }
}

/** `campo` is the name the user knows, with its article: "El stock inicial", "El punto de reorden". */
function validarEntero(n: number, campo: string): Validado<number> {
  if (typeof n !== "number" || !Number.isInteger(n)) return { aviso: `${campo} tiene que ser un número entero` }
  if (n < 0) return { aviso: `${campo} no puede ser negativo` }
  if (n > LIMITES.enteroMax) return { aviso: `${campo} es demasiado grande` }
  return { valor: n }
}

const CAMPO_ENTERO = {
  stockInicial: "El stock inicial",
  stockMinimo: "El stock mínimo",
  stockMaximo: "El stock máximo",
  puntoReorden: "El punto de reorden",
} as const

function validarTextoDeFila(texto: string, max: number, largo: string): Validado<string> {
  if (longitud(texto) > max) return { aviso: largo }
  if (texto.includes(NUL)) return { aviso: NO_ADMITIDO }
  return { valor: texto }
}

function cambiarCodigoBase(estado: VariantesState, codigo: string): Resultado {
  if (/\p{Cc}/u.test(codigo)) return NO_ADMITIDO
  if (longitud(codigo) > LIMITES.codigo) return "El código puede tener hasta 100 caracteres"
  return rederivarCodigos({ ...estado, codigoBase: codigo })
}

function cambiarPrecioBase(estado: VariantesState, precio: number): Resultado {
  const validado = validarMonto(precio, "precio")
  if ("aviso" in validado) return validado.aviso
  const filas = Object.fromEntries(
    // Saved rows (restored ones included) are never "untouched": the client does not own their price.
    Object.entries(estado.filas).map(([id, f]) => [id, !f.precioTocado && !f.restaurada ? { ...f, precioVenta: validado.valor } : f])
  )
  return { ...estado, precioBase: validado.valor, filas }
}

/** New rows still on the old base cost follow the new one; a cost somebody typed, or a saved one, stays. */
function cambiarCostoBase(estado: VariantesState, costo: number): Resultado {
  const validado = validarMonto(costo, "costo")
  if ("aviso" in validado) return validado.aviso
  if (!estado.costoCargado) return { ...estado, costoBase: validado.valor }
  const filas = Object.fromEntries(
    Object.entries(estado.filas).map(([id, f]) => [id, !f.existente && f.precioCompra === estado.costoBase ? { ...f, precioCompra: validado.valor } : f])
  )
  return { ...estado, costoBase: validado.valor, filas }
}

/** "Aplicar precio a todas": every active row takes the base price and goes back to following it. */
function aplicarPrecioATodas(estado: VariantesState): Resultado {
  const filas = Object.fromEntries(
    Object.entries(estado.filas).map(([id, f]) => [
      id,
      // Only new rows go back to following the base. A saved row (restored and promoted ones too) stays marked:
      // the base never reprices it again, and a restored row's new price is the one that gets sent.
      f.archivar ? f : { ...f, precioVenta: estado.precioBase, precioTocado: f.existente },
    ])
  )
  return { ...estado, filas }
}

function editarFila(estado: VariantesState, filaId: string, c: CambiosDeFila): Resultado {
  const fila = estado.filas[filaId]
  if (!fila || fila.archivar) return estado
  const siguiente: Fila = { ...fila, extra: { ...fila.extra } }
  let cambio = false

  if (c.codigo !== undefined) {
    const v = validarTextoDeFila(c.codigo, LIMITES.codigo, "El código puede tener hasta 100 caracteres")
    if ("aviso" in v) return v.aviso
    siguiente.codigo = v.valor
    siguiente.codigoTocado = true
    cambio = true
  }
  if (c.barcode !== undefined) {
    const texto = c.barcode === null ? "" : c.barcode.trim()
    const v = validarTextoDeFila(texto, LIMITES.barcode, "El código de barras puede tener hasta 100 caracteres")
    if ("aviso" in v) return v.aviso
    siguiente.barcode = v.valor === "" ? null : v.valor
    cambio = true
  }
  if (c.precioVenta !== undefined) {
    const v = validarMonto(c.precioVenta, "precio")
    if ("aviso" in v) return v.aviso
    siguiente.precioVenta = v.valor
    siguiente.precioTocado = true
    cambio = true
  }
  if (c.precioCompra !== undefined && estado.costoCargado) {
    const v = validarMonto(c.precioCompra, "costo")
    if ("aviso" in v) return v.aviso
    siguiente.precioCompra = v.valor
    cambio = true
  }
  if (c.stockInicial !== undefined && !fila.existente) {
    const v = validarEntero(c.stockInicial, CAMPO_ENTERO.stockInicial)
    if ("aviso" in v) return v.aviso
    siguiente.stockInicial = v.valor
    cambio = true
  }
  for (const campo of ["stockMinimo", "stockMaximo", "puntoReorden"] as const) {
    const crudo = c[campo]
    if (crudo === undefined) continue
    if (crudo === null) siguiente.extra[campo] = null
    else {
      const v = validarEntero(crudo, CAMPO_ENTERO[campo])
      if ("aviso" in v) return v.aviso
      siguiente.extra[campo] = v.valor
    }
    cambio = true
  }
  if (c.ubicacion !== undefined) {
    const v = validarTextoDeFila(c.ubicacion ?? "", LIMITES.ubicacion, "La ubicación puede tener hasta 100 caracteres")
    if ("aviso" in v) return v.aviso
    siguiente.extra.ubicacion = v.valor.trim() === "" ? null : v.valor
    cambio = true
  }

  const { stockMinimo, stockMaximo } = siguiente.extra
  if (stockMinimo !== null && stockMaximo !== null && stockMinimo > stockMaximo) return "El stock mínimo no puede superar al máximo"
  if (!cambio) return estado
  return { ...estado, filas: { ...estado.filas, [filaId]: siguiente } }
}

/**
 * A standalone item becomes one combination of the new group: it takes over a NEW row (the one given, else
 * the first), keeping its id, code, price, stock and photo. Promoting again moves it and hands the slot it
 * left back as a new row. It never replaces a saved row of the group.
 */
function promover(estado: VariantesState, item: ItemPromovido, filaId: string | undefined, generarId: () => string): Resultado {
  const activas = filasEnOrden(estado).filter((f) => !f.archivar)
  if (activas.length === 0) return "Primero agregá las opciones y los valores del producto"

  const previa = estado.promocionId ? estado.filas[estado.promocionId] : undefined
  const sitioActual = previa && previa.id === item.id ? previa : undefined
  const destino = filaId !== undefined ? estado.filas[filaId] : sitioActual ?? activas.find((f) => !f.existente)
  if (!destino || (destino.existente && destino.id !== previa?.id)) return "Elegí una combinación nueva para el producto"

  const promovida: Fila = {
    id: item.id,
    valorIds: destino.valorIds,
    existente: true,
    archivar: false,
    codigo: item.codigo,
    codigoTocado: true,
    barcode: item.barcode && item.barcode.trim() !== "" ? item.barcode : null,
    precioVenta: item.precioVenta,
    precioTocado: true,
    stockInicial: 0,
    stock: item.stock,
    stockReservado: item.stockReservado ?? 0,
    imagenUrl: urlGuardada(item.imagenUrl),
    extra: {
      stockMinimo: item.stockMinimo ?? null,
      stockMaximo: item.stockMaximo ?? null,
      puntoReorden: item.puntoReorden ?? null,
      ubicacion: item.ubicacion ?? null,
    },
  }
  if (estado.costoCargado && typeof item.precioCompra === "number") promovida.precioCompra = item.precioCompra

  const filas = { ...estado.filas }
  delete filas[destino.id]
  if (previa) delete filas[previa.id]
  filas[item.id] = promovida
  if (previa && previa.id !== destino.id) {
    const usados = Object.values(filas).map((f) => f.codigo).filter((c) => c !== "")
    const texto = atributosDe(estado, previa).map((a) => a.valor)
    const id = generarId()
    filas[id] = filaNueva(estado, id, previa.valorIds, generarCodigoVariante(estado.codigoBase, texto, usados))
  }
  // A generated code that equals the promoted item's code is re-derived around it.
  return rederivarCodigos(reordenar({ ...estado, promocionId: item.id, filas }))
}

function reducir(estado: VariantesState, accion: VariantesAccion, generarId: () => string): Resultado {
  switch (accion.tipo) {
    case "reemplazar":
      return accion.estado
    case "activar":
      return { ...estado, activo: true }
    case "desactivar":
      return { ...estado, activo: false }
    case "agregarOpcion":
      return agregarOpcion(estado, accion.nombre, accion.valores ?? [], generarId)
    case "renombrarOpcion":
      return renombrarOpcion(estado, accion.opcionId, accion.nombre)
    case "quitarOpcion":
      return quitarOpcion(estado, accion.opcionId)
    case "agregarValor":
      return agregarValor(estado, accion.opcionId, accion.texto, generarId)
    case "agregarValores":
      return agregarValores(estado, accion.opcionId, accion.textos)
    case "renombrarValor":
      return renombrarValor(estado, accion.valorId, accion.texto)
    case "quitarValor":
      return quitarValor(estado, accion.valorId)
    case "deshacerArchivo":
      return deshacerArchivo(estado, accion.filaId, generarId)
    case "cambiarCodigoBase":
      return cambiarCodigoBase(estado, accion.codigo)
    case "cambiarPrecioBase":
      return cambiarPrecioBase(estado, accion.precio)
    case "cambiarCostoBase":
      return cambiarCostoBase(estado, accion.costo)
    case "aplicarPrecioATodas":
      return aplicarPrecioATodas(estado)
    case "editarFila":
      return editarFila(estado, accion.filaId, accion.cambios)
    case "promover":
      return promover(estado, accion.item, accion.filaId, generarId)
  }
}

/**
 * The reducer of the variants section. Pure, no randomness: new row, option and value ids derive from
 * (`estado.semilla`, `estado.contador`), and the returned state carries the advanced counter, so the same
 * action on the same state always gives the same state, ids included. A refused action returns the same
 * state plus the reason in `aviso` (the counter does not move); an accepted one clears it. An action aimed
 * at an id that does not exist changes nothing.
 */
export function crearReductor(): Reductor {
  return (estado, accion) => {
    const acuniar = acuniador(estado.semilla, estado.contador)
    const resultado = reducir(estado, accion, acuniar.siguiente)
    if (typeof resultado === "string") return { ...estado, aviso: resultado }
    if (resultado === estado || accion.tipo === "reemplazar" || accion.tipo === "agregarValores") return resultado
    return { ...resultado, aviso: null, contador: acuniar.contador }
  }
}
