import { isMissingColumnError } from "@/lib/db-errors"
import type { AtributoVariante } from "@/types"

// JS twins of the SQL functions of migration 355 (inventario_combinacion_clave and
// inventario_nombre_variante). The shared vectors in __tests__/helpers/variantes-vectores.ts
// and the SQL probes keep both sides honest (G3). The accent map below is the one in the
// SQL translate(): n-tilde is NOT folded, and normalize("NFD") must not replace it.

const ACENTOS = "áàäâéèëêíìïîóòöôúùüû"
const SIN_ACENTO = "aaaaeeeeiiiioooouuuu"
const SEPARADOR_CLAVE = String.fromCharCode(31)

type Atributos = readonly AtributoVariante[] | null | undefined

/** Values in option order. Entries without a string `valor` are skipped, like string_agg skips NULL. */
function valoresDe(atributos: Atributos): string[] {
  if (!Array.isArray(atributos)) return []
  return atributos.flatMap((a) => (typeof a?.valor === "string" ? [a.valor] : []))
}

/** trim() removes exactly the characters the SQL btrim() is given. */
function plegar(valor: string): string {
  let plano = ""
  for (const ch of valor.trim().toLowerCase()) {
    const i = ACENTOS.indexOf(ch)
    plano += i === -1 ? ch : SIN_ACENTO[i]
  }
  return plano
}

/**
 * Canonical key of a combination: the values only, folded for case, surrounding
 * whitespace and accents, joined with chr(31) in option order. Two combinations of
 * one group collide exactly when their keys are equal. SQL returns NULL for an empty
 * array; the JS twin returns "" (an empty combination can never be stored).
 */
export function claveCombinacion(atributos: Atributos): string {
  return valoresDe(atributos).map(plegar).join(SEPARADOR_CLAVE)
}

/** "Azul / M": the values as stored, in option order. null when there is nothing to show. */
export function etiquetaVariante(atributos: Atributos): string | null {
  const valores = valoresDe(atributos)
  return valores.length > 0 ? valores.join(" / ") : null
}

/** "{base} - {Value1} / {Value2}", or the base alone. Values are used as typed (no trim). */
export function nombreVariante(base: string, atributos: Atributos): string {
  const etiqueta = etiquetaVariante(atributos)
  return etiqueta === null ? base : `${base} - ${etiqueta}`
}

export interface OpcionDeGrupo {
  nombre: string
  valores: readonly string[]
}

export interface HermanoConFoto {
  id: string
  atributos: Atributos
  /** The sibling's OWN principal photo; null/empty when it has none. */
  foto: string | null | undefined
}

const SIN_ORDEN = Number.MAX_SAFE_INTEGER

/** Position of each option's value for a row, in option order. Unknown values rank last. */
function rangoDeCombinacion(opciones: readonly OpcionDeGrupo[], atributos: Atributos): number[] {
  const lista = Array.isArray(atributos) ? atributos : []
  return opciones.map((opcion) => {
    const atributo = lista.find((a) => typeof a?.opcion === "string" && plegar(a.opcion) === plegar(opcion.nombre))
    if (typeof atributo?.valor !== "string") return SIN_ORDEN
    const posicion = opcion.valores.findIndex((v) => plegar(v) === plegar(atributo.valor))
    return posicion === -1 ? SIN_ORDEN : posicion
  })
}

function compararRangos(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

/**
 * Display-only fallback photo of a variant without its own: the photo of the FIRST active
 * sibling, in combination order (option order, then value order of `opciones`), that has one.
 * The row itself never lends; unknown values rank last; ties go to the lowest id. Callers pass
 * ACTIVE siblings only (an archived row never lends). One definition of "first" for the group
 * GET, the inventory list and the POS sheet.
 */
export function fotoDeRespaldo(
  opciones: readonly OpcionDeGrupo[] | null | undefined,
  hermanos: readonly HermanoConFoto[],
  excluirId: string
): { url: string; deId: string } | null {
  const orden = opciones ?? []
  const candidatos = hermanos
    .filter((h) => h.id !== excluirId && typeof h.foto === "string" && h.foto.length > 0)
    .map((h) => ({ h, rango: rangoDeCombinacion(orden, h.atributos) }))
    .sort((a, b) => compararRangos(a.rango, b.rango) || (a.h.id < b.h.id ? -1 : a.h.id > b.h.id ? 1 : 0))
  const primero = candidatos[0]?.h
  return primero ? { url: primero.foto as string, deId: primero.id } : null
}

/** `fotoDeRespaldo` in the shape the payloads carry: the photo plus the lender's label ("Rojo / M"). */
export function imagenRespaldoDe(
  opciones: readonly OpcionDeGrupo[] | null | undefined,
  hermanos: readonly HermanoConFoto[],
  excluirId: string
): { url: string; etiqueta: string } | null {
  const prestada = fotoDeRespaldo(opciones, hermanos, excluirId)
  if (!prestada) return null
  const prestadora = hermanos.find((h) => h.id === prestada.deId)
  return { url: prestada.url, etiqueta: etiquetaVariante(prestadora?.atributos) ?? "" }
}

/** Client-generated id the save RPC accepts for a new row: `^c[0-9a-f]{24}$`. */
export function generarIdCliente(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return "c" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

/**
 * Runs `run` with the first SELECT; when the database lacks a column or relation of a
 * migration that is not applied yet, retries with the next, plainer SELECT. The
 * downgrade sticks for later calls of the returned function (build it once per
 * request), so a retry never goes back to the select that failed. Only
 * isMissingColumnError downgrades; any other error is returned or thrown untouched.
 */
export function selectConFallback<A extends unknown[], R extends { error?: unknown }>(
  run: (select: string, ...args: A) => PromiseLike<R>,
  pasos: readonly [string, ...string[]]
): (...args: A) => Promise<R> {
  let nivel = 0
  return async (...args) => {
    // Each call walks its own index: two calls in flight that fail at the same step must
    // not push each other past the last one. The shared level only ever moves forward.
    let i = nivel
    for (;;) {
      const ultimo = i === pasos.length - 1
      try {
        const resultado = await run(pasos[i], ...args)
        if (ultimo || !isMissingColumnError(resultado.error)) return resultado
      } catch (e) {
        if (ultimo || !isMissingColumnError(e)) throw e
      }
      i++
      nivel = Math.max(nivel, i)
    }
  }
}
