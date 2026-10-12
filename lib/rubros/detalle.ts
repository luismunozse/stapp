import type { RubroPack } from "./types"
import { DEFAULT_RUBRO_ID } from "./index"

/**
 * Camino genérico guiado.
 *
 * Los packs curados cubren los oficios con mercado propio, pero no escalan al
 * long tail: hay más de cien rubros de mostrador y cada pack exige conocimiento
 * de dominio que no tenemos (qué se le rompe a una máquina de café, qué repuesto
 * lleva una cortadora de pasto). Escribir contenido inventado es peor que no
 * tenerlo, porque el usuario primero tiene que borrarlo.
 *
 * En vez de eso el usuario escribe qué repara y de ahí derivamos lo único que
 * de verdad hace falta el día uno: el nombre del tipo de equipo y el vocabulario.
 * El resto (campos, accesorios, categorías, checklist) sale del pack genérico,
 * que es neutral a propósito, y los problemas comunes los va a cargar él —
 * o los vamos a deducir de sus órdenes reales más adelante.
 */

export interface DerivacionRubro {
  /** Código del tipo. SCREAMING_SNAKE, sin acentos, ≤20 chars. */
  codigo: string
  /** Nombre del tipo, en singular. Ej: "Máquina de café". */
  nombre: string
  /** Prefijo del número de orden. 2-5 letras mayúsculas. */
  prefijoOrden: string
  /** Vocabulario: singular. */
  equipo: string
  /** Vocabulario: plural. */
  equipoPlural: string
}

/** Límite de `codigo` en el schema de POST /api/tipos-dispositivo. */
const MAX_CODIGO = 20

/** Palabras de enlace: no se singularizan ni sirven para el prefijo. */
const ENLACES = new Set(["de", "del", "la", "las", "el", "los", "y", "con", "para", "a", "en"])

/**
 * Palabras que en plural terminan en "-es" porque el singular cierra en estas
 * consonantes (reloj → relojes, motor → motores). El resto de los plurales en
 * "s" son de palabras que ya terminaban en vocal (llave → llaves), donde sacar
 * "es" dejaría un tronco inválido ("llav").
 */
const CONSONANTES_ES = new Set(["r", "l", "n", "d", "j", "z", "s", "x"])

function sinAcentos(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "")
}

function singularizar(palabra: string): string {
  const base = sinAcentos(palabra).toLowerCase()
  if (base.length <= 3 || !base.endsWith("s")) return palabra

  if (base.endsWith("es")) {
    const tronco = base.slice(0, -2)
    const ultima = tronco.slice(-1)
    if (tronco.length >= 2 && CONSONANTES_ES.has(ultima)) {
      return palabra.slice(0, -2)
    }
  }

  return palabra.slice(0, -1)
}

function pluralizar(palabra: string): string {
  const base = sinAcentos(palabra).toLowerCase()
  if (base.endsWith("s")) return palabra
  return /[aeiou]$/.test(base) ? `${palabra}s` : `${palabra}es`
}

function capitalizar(texto: string): string {
  if (texto === "") return texto
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

/**
 * Deriva tipo y vocabulario del texto libre del registro.
 * Devuelve null si no queda nada usable: el llamador se queda con el pack base.
 */
export function derivarDesdeDetalle(detalle: string | null | undefined): DerivacionRubro | null {
  if (typeof detalle !== "string") return null

  // Se acota antes de procesar: nadie describe su oficio en 500 caracteres,
  // y evita trabajo inútil sobre un pegado accidental.
  const limpio = detalle
    .slice(0, 120)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()

  if (limpio === "") return null

  const palabras = limpio.split(" ").filter(Boolean)
  // Sin al menos una palabra con letras no hay nada que nombrar ("1", "###").
  if (!palabras.some((p) => /\p{L}/u.test(p))) return null

  const singulares = palabras.map((p) => (ENLACES.has(p) ? p : singularizar(p)))
  const nombre = capitalizar(singulares.join(" "))

  // Plural: solo la primera palabra significativa vuelve a plural.
  // "Máquina de café" → "Máquinas de café", no "Máquinas de cafés".
  const idxPrincipal = singulares.findIndex((p) => !ENLACES.has(p) && /\p{L}/u.test(p))
  const plurales = singulares.map((p, i) => (i === idxPrincipal ? pluralizar(p) : p))
  const equipoPlural = capitalizar(plurales.join(" "))

  const codigo = construirCodigo(singulares)
  if (codigo === null) return null

  return {
    codigo,
    nombre,
    prefijoOrden: construirPrefijo(singulares, idxPrincipal),
    equipo: nombre,
    equipoPlural,
  }
}

function construirCodigo(singulares: string[]): string | null {
  const crudo = sinAcentos(singulares.join("_"))
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")

  if (crudo === "") return null

  // Truncar puede partir una palabra al medio o dejar el guión bajo colgando.
  const cortado = crudo.slice(0, MAX_CODIGO).replace(/_+$/g, "")
  if (cortado === "") return null

  // El código tiene que empezar con letra: "4_TIEMPOS" no pasa el schema.
  return /^[A-Z]/.test(cortado) ? cortado : `X_${cortado}`.slice(0, MAX_CODIGO).replace(/_+$/g, "")
}

function construirPrefijo(singulares: string[], idxPrincipal: number): string {
  const principal = idxPrincipal >= 0 ? singulares[idxPrincipal] : singulares[0]
  const letras = sinAcentos(principal ?? "").toUpperCase().replace(/[^A-Z]/g, "")

  if (letras.length >= 3) return letras.slice(0, 3)
  if (letras.length === 2) return letras

  // Una sola letra (o ninguna): se completa con el resto del texto para no
  // devolver un prefijo de un caracter, que no pasa la validación.
  const todas = sinAcentos(singulares.join("")).toUpperCase().replace(/[^A-Z]/g, "")
  const relleno = todas.slice(0, 3)
  return relleno.length >= 2 ? relleno : `${relleno}EQ`.slice(0, 3)
}

/**
 * Devuelve una copia del pack con el tipo y el vocabulario que describió el
 * usuario. Solo aplica al pack genérico: un pack curado tiene tipos, marcas y
 * problemas propios que una derivación de texto libre no puede mejorar.
 */
export function personalizarPack(pack: RubroPack, detalle: string | null | undefined): RubroPack {
  if (pack.id !== DEFAULT_RUBRO_ID) return pack

  const derivado = derivarDesdeDetalle(detalle)
  if (!derivado) return pack

  const base = pack.tipos[0]

  return {
    ...pack,
    terminologia: {
      ...pack.terminologia,
      equipo: derivado.equipo,
      equipoPlural: derivado.equipoPlural,
    },
    tipos: [
      {
        ...base,
        codigo: derivado.codigo,
        nombre: derivado.nombre,
        prefijoOrden: derivado.prefijoOrden,
      },
    ],
    // Los checklists del pack genérico no declaran tipo; ahora que hay uno solo
    // y con nombre propio, conviene vincularlos para que aparezcan al recibir.
    checklists: pack.checklists.map((c) => ({
      ...c,
      tipoCodigo: c.tipoCodigo ?? derivado.codigo,
    })),
  }
}
