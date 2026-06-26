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
