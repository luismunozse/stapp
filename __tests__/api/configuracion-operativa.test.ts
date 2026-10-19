import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockAuthError, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn(),
}))

vi.mock("@/lib/facturacion/access", () => ({
  canEmitirFacturaElectronica: vi.fn(),
}))

import { hasPlanFeature } from "@/lib/subscriptions"
import { canEmitirFacturaElectronica } from "@/lib/facturacion/access"
import { GET } from "@/app/api/configuracion/operativa/route"

const orgAditivo = {
  id: "org-1",
  nombre: "Taller",
  nombre_mostrar: "Taller Centro",
  moneda: "CRC",
  zona_horaria: "America/Costa_Rica",
  pais: "CR",
  iva_regimen: "ADITIVO",
  iva_tasa: 13,
  redondeo_efectivo: 5,
  garantia_dias_default: 45,
  terminologia: null,
}

describe("GET /api/configuracion/operativa", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(hasPlanFeature).mockResolvedValue(true)
    vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(true)
  })

  it("un VENDEDOR recibe el régimen fiscal y la moneda de su org (antes: 403 y POS como EXENTO)", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })
    mockSupabaseFrom({ organizations: createChainMock(orgAditivo) })

    const { status, body } = await parseResponse(await GET())

    expect(status).toBe(200)
    expect(body).toMatchObject({
      ivaRegimen: "ADITIVO",
      ivaTasa: 13,
      redondeoEfectivo: 5,
      garantiaDiasDefault: 45,
      moneda: "CRC",
      zonaHoraria: "America/Costa_Rica",
      pais: "CR",
      nombreEmpresa: "Taller Centro",
    })
  })

  it("un TECNICO también puede leerla (el POS lo habilita la org)", async () => {
    mockAuthSuccess({ role: "TECNICO" })
    mockSupabaseFrom({ organizations: createChainMock(orgAditivo) })

    const { status } = await parseResponse(await GET())
    expect(status).toBe(200)
  })

  describe("facturacionElectronicaDisponible (gate real de emisión)", () => {
    const orgAR = { ...orgAditivo, pais: "AR" }

    it("ADMIN con emisión habilitada (plan, AR, toggle, credenciales) => true, evaluada para su org", async () => {
      mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
      mockSupabaseFrom({ organizations: createChainMock(orgAR) })

      const { body } = await parseResponse(await GET())

      expect(body.facturacionElectronicaDisponible).toBe(true)
      expect(canEmitirFacturaElectronica).toHaveBeenCalledWith("org-1")
    })

    it("ADMIN cuando canEmitir da false (toggle apagado, sin credenciales, no AR, sin plan) => false", async () => {
      vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(false)
      mockAuthSuccess({ role: "ADMIN" })
      mockSupabaseFrom({ organizations: createChainMock(orgAR) })

      const { status, body } = await parseResponse(await GET())

      expect(status).toBe(200)
      expect(body.facturacionElectronicaDisponible).toBe(false)
    })

    it("un no-ADMIN recibe false sin siquiera evaluar el acceso", async () => {
      for (const role of ["VENDEDOR", "TECNICO"]) {
        mockAuthSuccess({ role })
        mockSupabaseFrom({ organizations: createChainMock(orgAR) })
        expect((await parseResponse(await GET())).body.facturacionElectronicaDisponible).toBe(false)
      }
      expect(canEmitirFacturaElectronica).not.toHaveBeenCalled()
    })

    it("si el chequeo de acceso tira, responde false y el endpoint sigue en 200", async () => {
      vi.mocked(canEmitirFacturaElectronica).mockRejectedValue(new Error("boom"))
      mockAuthSuccess({ role: "ADMIN" })
      mockSupabaseFrom({ organizations: createChainMock(orgAR) })

      const { status, body } = await parseResponse(await GET())

      expect(status).toBe(200)
      expect(body.facturacionElectronicaDisponible).toBe(false)
      expect(body.moneda).toBe("CRC")
    })
  })

  it("sin tasa propia usa la del país, y sin config cae a EXENTO / 30 días", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })
    mockSupabaseFrom({
      organizations: createChainMock({ id: "org-1", nombre: "T", pais: "AR", iva_tasa: null }),
    })

    const { body } = await parseResponse(await GET())
    expect(body.ivaRegimen).toBe("EXENTO")
    expect(body.ivaTasa).toBe(21)
    expect(body.redondeoEfectivo).toBe(0)
    expect(body.garantiaDiasDefault).toBe(30)
    expect(body.moneda).toBe("ARS")
  })

  it("sin sesión responde 401", async () => {
    mockAuthError()
    const res = await GET()
    expect(res.status).toBe(401)
  })
})
