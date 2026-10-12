// @vitest-environment node
/**
 * Tests: facturacion_electronica_habilitada toggle en /api/configuracion
 *
 * Suite 1 — GET: expone facturacionElectronicaHabilitada (columna) y
 *           facturacionElectronicaDisponible (gate comercial: pais=AR + plan feature)
 * Suite 2 — PUT: acepta facturacionElectronicaHabilitada y lo persiste
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"
import { hasPlanFeature } from "@/lib/subscriptions"

// ─── Module mocks (hoisted before route imports) ─────────────────────────────

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn(),
}))

// ─── Route imports (after mocks) ─────────────────────────────────────────────

import { GET, PUT } from "@/app/api/configuracion/route"

function createPutRequest(body: any, url = "http://localhost:3000/api/configuracion"): Request {
  return new Request(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

const baseOrgData = {
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
  vendedores_administran_inventario: false,
  iva_regimen: "EXENTO",
  iva_tasa: 21,
  redondeo_efectivo: 0,
  comision_aplica_sin_reparacion: false,
  terminologia: {},
}

describe("GET /api/configuracion — facturacion electronica", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns facturacionElectronicaHabilitada from the column", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.mocked(hasPlanFeature).mockResolvedValue(true)
    mockSupabaseFrom({
      organizations: createChainMock({
        ...baseOrgData,
        facturacion_electronica_habilitada: true,
      }),
    })

    const res = await GET()
    const { status, body } = await parseResponse(res as Response)

    expect(status).toBe(200)
    expect(body.facturacionElectronicaHabilitada).toBe(true)
  })

  it("returns facturacionElectronicaDisponible=true when pais=AR and plan has the feature", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.mocked(hasPlanFeature).mockResolvedValue(true)
    mockSupabaseFrom({
      organizations: createChainMock({
        ...baseOrgData,
        pais: "AR",
        facturacion_electronica_habilitada: false,
      }),
    })

    const res = await GET()
    const { status, body } = await parseResponse(res as Response)

    expect(status).toBe(200)
    expect(body.facturacionElectronicaDisponible).toBe(true)
    expect(hasPlanFeature).toHaveBeenCalledWith("org-1", "facturacion_electronica")
  })

  it("returns facturacionElectronicaDisponible=false when pais is not AR, even if the plan has the feature", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.mocked(hasPlanFeature).mockResolvedValue(true)
    mockSupabaseFrom({
      organizations: createChainMock({
        ...baseOrgData,
        pais: "MX",
        facturacion_electronica_habilitada: false,
      }),
    })

    const res = await GET()
    const { status, body } = await parseResponse(res as Response)

    expect(status).toBe(200)
    expect(body.facturacionElectronicaDisponible).toBe(false)
  })

  it("returns facturacionElectronicaDisponible=false when the plan lacks the feature", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.mocked(hasPlanFeature).mockResolvedValue(false)
    mockSupabaseFrom({
      organizations: createChainMock({
        ...baseOrgData,
        pais: "AR",
        facturacion_electronica_habilitada: false,
      }),
    })

    const res = await GET()
    const { status, body } = await parseResponse(res as Response)

    expect(status).toBe(200)
    expect(body.facturacionElectronicaDisponible).toBe(false)
  })
})

describe("PUT /api/configuracion — facturacionElectronicaHabilitada field", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("PUT with facturacionElectronicaHabilitada=true saves facturacion_electronica_habilitada=true to DB", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })

    const updatedOrg = {
      ...baseOrgData,
      facturacion_electronica_habilitada: true,
    }

    const updateSpy = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: updatedOrg, error: null }),
        }),
      }),
    })

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "organizations") {
        return {
          update: updateSpy,
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: updatedOrg, error: null }),
            }),
          }),
        } as any
      }
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    })

    const res = await PUT(createPutRequest({ facturacionElectronicaHabilitada: true }))
    const { status, body } = await parseResponse(res as Response)

    expect(status).toBe(200)
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ facturacion_electronica_habilitada: true })
    )
    expect(body.facturacionElectronicaHabilitada).toBe(true)
  })
})
