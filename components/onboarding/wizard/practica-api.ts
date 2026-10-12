import type { PracticaOrden } from "@/lib/onboarding/practica-shared"

export interface NuevaPractica {
  tipoDispositivo: string
  dispositivo: string
  problemaReportado: string
}

export type ResultadoPractica =
  | { ok: true; practica: PracticaOrden | null }
  | { ok: false; status: number; error: string }

const URL_PRACTICA = "/api/onboarding/practica"
const JSON_HEADERS = { "Content-Type": "application/json" }
const SIN_CONEXION = "No pudimos conectarnos. Revisá tu conexión y probá de nuevo."
const ERROR_GENERICO = "Algo salió mal. Probá de nuevo."

/** One request to the practice endpoint, never throwing: status 0 means no connection. */
async function pedir(init: RequestInit): Promise<ResultadoPractica> {
  try {
    const res = await fetch(URL_PRACTICA, init)
    const body = await res.json().catch(() => null)
    if (!res.ok) return { ok: false, status: res.status, error: body?.error || ERROR_GENERICO }
    return { ok: true, practica: (body?.practica ?? null) as PracticaOrden | null }
  } catch {
    return { ok: false, status: 0, error: SIN_CONEXION }
  }
}

export const practicaApi = {
  leer: () => pedir({ method: "GET", cache: "no-store" }),
  crear: (body: NuevaPractica) => pedir({ method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) }),
  reparar: (costoFinal: number) =>
    pedir({ method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ accion: "reparar", costoFinal }) }),
  entregar: () => pedir({ method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ accion: "entregar" }) }),
}
