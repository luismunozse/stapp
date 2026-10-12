export interface TerminoDef {
  key: string
  default: string
  label: string
  help?: string
}

export const TERMINOS: TerminoDef[] = [
  { key: "equipo", default: "Equipo", label: "Equipo (singular)", help: "Lo que se repara. Ej: Vehículo, Electrodoméstico, Reloj." },
  { key: "equipoPlural", default: "Equipos", label: "Equipo (plural)" },
  { key: "orden", default: "Orden de trabajo", label: "Orden" },
  { key: "serie", default: "Número de serie", label: "Identificador del equipo", help: "Ej: IMEI, Patente, N° de chasis." },
  { key: "tecnico", default: "Técnico", label: "Responsable del trabajo" },
  { key: "reparacion", default: "Reparación", label: "Trabajo / Reparación" },
  { key: "marca", default: "Marca", label: "Marca" },
  { key: "modelo", default: "Modelo", label: "Modelo" },
]

export type Terminologia = Record<string, string>

/** Mapa completo: cada key del catálogo → override no-vacío o default. */
export function resolveTerminologia(overrides?: Terminologia | null): Terminologia {
  const out: Terminologia = {}
  for (const def of TERMINOS) {
    const ov = overrides?.[def.key]
    out[def.key] = ov && ov.trim() !== "" ? ov : def.default
  }
  return out
}

/** Lookup de una clave en un mapa ya resuelto. */
export function t(map: Terminologia, key: string): string {
  return map[key] ?? key
}

/**
 * Sanitize raw terminologia input: keep only known catalog keys with
 * non-empty trimmed string values. Safe to call from API PUT handlers.
 */
export function sanitizeTerminologia(
  input: Record<string, unknown> | null | undefined
): Terminologia {
  if (!input || typeof input !== "object") return {}
  const known = new Set(TERMINOS.map((d) => d.key))
  const clean: Terminologia = {}
  for (const [k, v] of Object.entries(input)) {
    if (known.has(k) && typeof v === "string" && v.trim() !== "") {
      clean[k] = v.trim()
    }
  }
  return clean
}

/** Feminine words that do not end in a feminine suffix. */
const FEMENINOS_SIN_SUFIJO = new Set([
  "moto",
  "radio",
  "foto",
  "mano",
  "bici",
  "llave",
  "notebook",
  "tablet",
  "laptop",
  "pc",
  "fuente",
  "tele",
  "red",
  "luz",
])
/** Masculine words that end in -a. */
const MASCULINOS_EN_A = new Set(["sistema", "problema", "programa", "mapa", "dia", "sofa", "tema", "clima", "idioma", "planeta"])
const SUFIJO_FEMENINO = /(a|cion|sion|dad|tad|tud|umbre)$/

/**
 * Indefinite article for a vocabulary term, so copy like "¿Tenés un equipo
 * para cargar?" agrees with feminine terms ("una pieza"). Heuristic on the
 * first word: genérico shops get free-text terms, so a fixed map cannot cover
 * them, and the two exception lists catch the common words that break it.
 */
export function articuloIndefinido(termino: string): "un" | "una" {
  const primera = (termino.trim().split(/\s+/)[0] ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
  if (FEMENINOS_SIN_SUFIJO.has(primera)) return "una"
  if (MASCULINOS_EN_A.has(primera)) return "un"
  return SUFIJO_FEMENINO.test(primera) ? "una" : "un"
}

/**
 * Lowercases only the first letter, and only when the second is not uppercase,
 * so a term can sit mid-sentence without breaking acronyms: "Pieza" -> "pieza",
 * "TV" stays "TV".
 */
export function minusculaInicial(termino: string): string {
  const [primera, segunda] = termino
  if (primera === undefined) return termino
  if (segunda !== undefined && segunda !== segunda.toLowerCase()) return termino
  return primera.toLowerCase() + termino.slice(1)
}
