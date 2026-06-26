// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"

describe("/api/configuracion — terminologia", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it("GET includes terminologia resolved with defaults when org has no overrides", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    // The GET does a primary query; if it doesn't error we take that branch
    const orgData = {
      id: "org-1",
      logo_url: null,
      logo_path: null,
      nombre_mostrar: "Test Org",
      nombre: "Test Org",
      email: "test@test.com",
      telefono: null,
      direccion: null,
      ciudad: null,
      provincia: null,
      codigo_postal: null,
      moneda: "ARS",
      zona_horaria: "America/Argentina/Buenos_Aires",
      umbral_stock_bajo: 5,
      iva_porcentaje: 0,
      cotizacion_validez_dias: 30,
      cotizacion_terminos: null,
      recepcion_terminos: null,
      comprobante_terminos: null,
      garantia_dias_default: 30,
      politica_abandono_dias_default: 60,
      anticipo_porcentaje_default: 50,
      pais: "AR",
      modulo_agenda: false,
      iva_regimen: "EXENTO",
      iva_tasa: 21,
      redondeo_efectivo: 0,
      comision_aplica_sin_reparacion: false,
      terminologia: {},
    }
    mockSupabaseFrom({
      organizations: createChainMock(orgData),
    })
    const { GET } = await import("@/app/api/configuracion/route")
    const res = await GET()
    const { status, body } = await parseResponse(res as Response)
    expect(status).toBe(200)
    expect(body.terminologia).toBeDefined()
    expect(body.terminologia.equipo).toBe("Equipo")
    expect(body.terminologia.orden).toBe("Orden de trabajo")
    expect(body.terminologia.serie).toBe("Número de serie")
  })

  it("GET applies org overrides in terminologia response", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const orgData = {
      id: "org-1",
      logo_url: null, logo_path: null, nombre_mostrar: "Test", nombre: "Test",
      email: null, telefono: null, direccion: null, ciudad: null, provincia: null,
      codigo_postal: null, moneda: "ARS", zona_horaria: "America/Argentina/Buenos_Aires",
      umbral_stock_bajo: 5, iva_porcentaje: 0, cotizacion_validez_dias: 30,
      cotizacion_terminos: null, recepcion_terminos: null, comprobante_terminos: null,
      garantia_dias_default: 30, politica_abandono_dias_default: 60,
      anticipo_porcentaje_default: 50, pais: "AR", modulo_agenda: false,
      iva_regimen: "EXENTO", iva_tasa: 21, redondeo_efectivo: 0,
      comision_aplica_sin_reparacion: false,
      terminologia: { equipo: "Vehículo", serie: "Patente" },
    }
    mockSupabaseFrom({ organizations: createChainMock(orgData) })
    const { GET } = await import("@/app/api/configuracion/route")
    const res = await GET()
    const { status, body } = await parseResponse(res as Response)
    expect(status).toBe(200)
    expect(body.terminologia.equipo).toBe("Vehículo")
    expect(body.terminologia.serie).toBe("Patente")
    expect(body.terminologia.orden).toBe("Orden de trabajo") // unchanged default
  })
})

// Unit test for sanitizeTerminologia — isolated from route complexity
describe("sanitizeTerminologia", () => {
  it("keeps known keys with non-empty trimmed values, drops unknown keys and empties", async () => {
    const { sanitizeTerminologia } = await import("@/lib/terminologia")
    const result = sanitizeTerminologia({
      equipo: "Vehículo",
      hackeo: "x",        // unknown — must be dropped
      serie: "  ",        // whitespace-only — must be dropped
      modelo: "",         // empty — must be dropped
      orden: "Trabajo",
    })
    expect(result.equipo).toBe("Vehículo")
    expect(result.orden).toBe("Trabajo")
    expect(result.hackeo).toBeUndefined()
    expect(result.serie).toBeUndefined()
    expect(result.modelo).toBeUndefined()
  })

  it("returns empty object for null/undefined input", async () => {
    const { sanitizeTerminologia } = await import("@/lib/terminologia")
    expect(sanitizeTerminologia(null)).toEqual({})
    expect(sanitizeTerminologia(undefined)).toEqual({})
  })
})
