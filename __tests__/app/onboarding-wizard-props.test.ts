// @vitest-environment node
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

type Respuesta = { data?: unknown; count?: number | null; error?: unknown }
const respuestas: Record<string, Respuesta> = {}
const llamadas: Array<{ tabla: string; metodo: string; args: unknown[] }> = []

/**
 * Chainable stand-in for a PostgREST builder: every method returns the
 * builder, and awaiting it (or .single()) yields the canned response for its table.
 */
function builder(tabla: string): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (value: Respuesta) => void) => resolve(respuestas[tabla] ?? { data: null })
        }
        return (...args: unknown[]) => {
          llamadas.push({ tabla, metodo: String(prop), args })
          return prop === "single" || prop === "maybeSingle"
            ? Promise.resolve(respuestas[tabla] ?? { data: null })
            : proxy
        }
      },
    }
  )
  return proxy
}

vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: (tabla: string) => builder(tabla) } }))

const getPracticaOrden = vi.fn()
const countRealOrders = vi.fn()
vi.mock("@/lib/onboarding/practica", () => ({
  getPracticaOrden: (...args: unknown[]) => getPracticaOrden(...args),
  countRealOrders: (...args: unknown[]) => countRealOrders(...args),
}))

import { loadOnboardingWizardProps, tiposParaPractica } from "@/app/(dashboard)/onboarding/wizard-props"

const PARAMS = { organizationId: "org-1", userId: "user-1", fallbackNombre: "Sesión", fallbackEmail: "sesion@test.com" }
const PRACTICA = {
  id: "prac-1",
  estado: "RECIBIDO",
  publicToken: "tok-123",
  tipoDispositivo: "HELADERA",
  dispositivo: "Gafa",
  problemaReportado: "No enfría",
  costoFinal: null,
}

beforeEach(() => {
  llamadas.length = 0
  for (const key of Object.keys(respuestas)) delete respuestas[key]
  respuestas.organizations = { data: { nombre: "taller-ana", moneda: "ARS" } }
  getPracticaOrden.mockReset().mockResolvedValue(null)
  countRealOrders.mockReset().mockResolvedValue(0)
})

afterEach(() => vi.restoreAllMocks())

describe("loadOnboardingWizardProps", () => {
  it("builds the props from the org, the owner, the tipos and the practice", async () => {
    respuestas.organizations = {
      data: {
        nombre: "taller-ana",
        nombre_mostrar: "Taller Ana",
        logo_url: "https://cdn.test/l.png",
        rubro: "electrodomesticos",
        rubro_detalle: null,
        moneda: "CLP",
        terminologia: { equipo: "Artefacto" },
      },
    }
    respuestas.users = { data: { nombre: "Ana Pérez", email: "ana@taller.test" } }
    respuestas.tipos_dispositivo = {
      data: [{ codigo: "HELADERA", nombre: "Heladera / Freezer", config: { marcas: ["Gafa"], problemasComunes: ["No enfría"] } }],
    }
    countRealOrders.mockResolvedValue(2)
    getPracticaOrden.mockResolvedValue(PRACTICA)

    const props = await loadOnboardingWizardProps(PARAMS)

    expect(props).toEqual({
      nombreNegocio: "Taller Ana",
      logoUrl: "https://cdn.test/l.png",
      rubro: "electrodomesticos",
      rubroDetalle: null,
      ownerNombre: "Ana Pérez",
      ownerEmail: "ana@taller.test",
      tipos: [{ codigo: "HELADERA", nombre: "Heladera / Freezer", marcas: ["Gafa"], problemasComunes: ["No enfría"] }],
      terminologia: expect.objectContaining({ equipo: "Artefacto", orden: "Orden de trabajo" }),
      moneda: "CLP",
      ordenesRealesCount: 2,
      practica: PRACTICA,
    })
    expect(getPracticaOrden).toHaveBeenCalledWith("org-1")
  })

  it("counts the org's real orders through countRealOrders", async () => {
    await loadOnboardingWizardProps(PARAMS)

    expect(countRealOrders).toHaveBeenCalledWith("org-1")
    expect(llamadas.some((l) => l.tabla === "ordenes_servicio")).toBe(false)
  })

  it("reads 0 real orders when the count throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    countRealOrders.mockRejectedValue(new Error("db down"))

    const props = await loadOnboardingWizardProps(PARAMS)

    expect(props.ordenesRealesCount).toBe(0)
    expect(error).toHaveBeenCalled()
  })

  it("reads no practice when loading it throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    getPracticaOrden.mockRejectedValue(new Error("db down"))

    const props = await loadOnboardingWizardProps(PARAMS)

    expect(props.practica).toBeNull()
    expect(error).toHaveBeenCalled()
  })

  it("reads only the org's active tipos, in their order", async () => {
    await loadOnboardingWizardProps(PARAMS)

    const tipos = llamadas.filter((l) => l.tabla === "tipos_dispositivo")
    expect(tipos.map((l) => [l.metodo, ...l.args])).toEqual(
      expect.arrayContaining([
        ["eq", "organization_id", "org-1"],
        ["eq", "activo", true],
        ["order", "orden", { ascending: true }],
      ])
    )
  })

  it("logs and throws when the org read fails, instead of rendering a blank org", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    respuestas.organizations = { data: null, error: { message: "boom" } }

    await expect(loadOnboardingWizardProps(PARAMS)).rejects.toThrow()
    expect(error).toHaveBeenCalled()
  })

  it("logs and throws when the org row is missing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    respuestas.organizations = { data: null, error: null }

    await expect(loadOnboardingWizardProps(PARAMS)).rejects.toThrow()
    expect(error).toHaveBeenCalled()
  })

  it("logs a tipos read error and offers no tipos", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    respuestas.tipos_dispositivo = { data: null, error: { message: "boom" } }

    const props = await loadOnboardingWizardProps(PARAMS)

    expect(props.tipos).toEqual([])
    expect(error).toHaveBeenCalled()
  })

  it("logs an owner read error and falls back to the session", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    respuestas.users = { data: null, error: { message: "boom" } }

    const props = await loadOnboardingWizardProps(PARAMS)

    expect(props.ownerNombre).toBe("Sesión")
    expect(error).toHaveBeenCalled()
  })

  it("falls back for a bare org: name, unknown rubro and currency, missing owner row", async () => {
    respuestas.organizations = {
      data: {
        nombre: "taller-ana",
        nombre_mostrar: null,
        logo_url: null,
        rubro: "inexistente",
        rubro_detalle: null,
        moneda: "XXX",
        terminologia: null,
      },
    }

    const props = await loadOnboardingWizardProps(PARAMS)

    expect(props.nombreNegocio).toBe("taller-ana")
    expect(props.rubro).toBe("generico")
    expect(props.moneda).toBe("ARS")
    expect(props.terminologia.equipo).toBe("Equipo")
    expect(props.ownerNombre).toBe("Sesión")
    expect(props.ownerEmail).toBe("sesion@test.com")
    expect(props.ordenesRealesCount).toBe(0)
    expect(props.tipos).toEqual([])
    expect(props.practica).toBeNull()
  })
})

describe("tiposParaPractica", () => {
  it("drops the TODOS bucket unless it is the only tipo", () => {
    const celular = { codigo: "CELULAR", nombre: "Celular", config: null }
    const todos = { codigo: "TODOS", nombre: "Todos los dispositivos", config: null }

    expect(tiposParaPractica([celular, todos]).map((t) => t.codigo)).toEqual(["CELULAR"])
    expect(tiposParaPractica([todos]).map((t) => t.codigo)).toEqual(["TODOS"])
  })

  it("ignores malformed config lists", () => {
    const [tipo] = tiposParaPractica([
      { codigo: "X", nombre: "X", config: { marcas: "Gafa", problemasComunes: [1, "", "Pierde agua"] } },
    ])
    expect(tipo.marcas).toEqual([])
    expect(tipo.problemasComunes).toEqual(["Pierde agua"])
  })
})

describe("wizard-props module", () => {
  it("is guarded with server-only: it imports the admin client and sits next to the page", () => {
    const fuente = readFileSync(join(process.cwd(), "app/(dashboard)/onboarding/wizard-props.ts"), "utf8")
    expect(fuente).toMatch(/^import "server-only"$/m)
  })
})
