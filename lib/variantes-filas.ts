import { LIMITES } from "@/lib/variantes-schema"

// PURE and client-importable: no I/O, no React, no server-only imports. The state of the
// variants section of the product form (rows keyed by child id) and the pure functions
// that derive from it. The hook and the components that use it come in later PRs.

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
