import type { Mock } from "vitest"
import type { OnboardingWizardProps } from "@/components/onboarding/wizard/types"
import type { PracticaOrden } from "@/lib/onboarding/practica-shared"
import { resolveTerminologia } from "@/lib/terminologia"

export function wizardProps(overrides: Partial<OnboardingWizardProps> = {}): OnboardingWizardProps {
  return {
    nombreNegocio: "",
    logoUrl: null,
    rubro: "electrodomesticos",
    rubroDetalle: null,
    ownerNombre: "Ana Pérez",
    ownerEmail: "ana@taller.test",
    tipos: [
      { codigo: "HELADERA", nombre: "Heladera / Freezer", marcas: ["Gafa", "Whirlpool"], problemasComunes: ["No enfría", "Pierde agua"] },
      { codigo: "LAVARROPAS", nombre: "Lavarropas / Secarropas", marcas: ["Drean"], problemasComunes: ["No centrifuga"] },
    ],
    terminologia: resolveTerminologia(null),
    moneda: "ARS",
    ordenesRealesCount: 0,
    practica: null,
    ...overrides,
  }
}

export function practica(overrides: Partial<PracticaOrden> = {}): PracticaOrden {
  return {
    id: "prac-1",
    estado: "RECIBIDO",
    publicToken: "tok-123",
    tipoDispositivo: "HELADERA",
    dispositivo: "Gafa HGF-357",
    problemaReportado: "No enfría",
    costoFinal: null,
    ...overrides,
  }
}

export type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown> }

export function json(body: unknown, status = 200): FakeResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

/**
 * Routes fetch by "METHOD url". A queue answers in order and repeats its last
 * entry; an Error entry is thrown (network failure). Unknown routes get 200 {}.
 */
export function routeFetch(mockFetch: Mock, table: Record<string, Array<FakeResponse | Error>>) {
  const queues = Object.fromEntries(Object.entries(table).map(([key, value]) => [key, [...value]]))
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const queue = queues[`${init?.method ?? "GET"} ${url}`]
    const next = queue && queue.length > 1 ? queue.shift() : queue?.[0]
    if (!next) return json({})
    if (next instanceof Error) throw next
    return next
  })
}

export function callsTo(mockFetch: Mock, method: string, url: string) {
  return mockFetch.mock.calls.filter(
    ([u, init]) => u === url && ((init as RequestInit | undefined)?.method ?? "GET") === method
  )
}

export function bodyOf(call: unknown[] | undefined) {
  const init = call?.[1] as RequestInit | undefined
  return init?.body ? JSON.parse(init.body as string) : undefined
}
