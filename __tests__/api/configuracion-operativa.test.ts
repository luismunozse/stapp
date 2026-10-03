import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockAuthError, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn(),
}))

import { hasPlanFeature } from "@/lib/subscriptions"
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

  it("un VENDEDOR recibe los valores por defecto de cotizaciones y el umbral de stock (antes: 403 e IVA 0)", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })
    mockSupabaseFrom({
      organizations: createChainMock({
        ...orgAditivo,
        iva_porcentaje: 21,
        cotizacion_validez_dias: 15,
        cotizacion_terminos: "Precios sujetos a stock",
        politica_abandono_dias_default: 90,
        anticipo_porcentaje_default: 30,
        umbral_stock_bajo: 3,
      }),
    })

    const { status, body } = await parseResponse(await GET())

    expect(status).toBe(200)
    expect(body).toMatchObject({
      ivaPorcentaje: 21,
      cotizacionValidezDias: 15,
      cotizacionTerminos: "Precios sujetos a stock",
      politicaAbandonoDiasDefault: 90,
      anticipoPorcentajeDefault: 30,
      umbralStockBajo: 3,
    })
  })

  it("no expone datos sensibles de la organización", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })
    mockSupabaseFrom({
      organizations: createChainMock({
        ...orgAditivo,
        cuit: "20-12345678-9",
        cbu_alias: "taller.centro",
        email: "admin@taller.com",
      }),
    })

    const { body } = await parseResponse(await GET())
    const texto = JSON.stringify(body)
    expect(texto).not.toContain("20-12345678-9")
    expect(texto).not.toContain("taller.centro")
    expect(texto).not.toContain("admin@taller.com")
  })

  it("un TECNICO también puede leerla (el POS lo habilita la org)", async () => {
    mockAuthSuccess({ role: "TECNICO" })
    mockSupabaseFrom({ organizations: createChainMock(orgAditivo) })

    const { status } = await parseResponse(await GET())
    expect(status).toBe(200)
  })

  it("la facturación electrónica solo se ofrece al ADMIN de una org argentina con el plan", async () => {
    const orgAR = { ...orgAditivo, pais: "AR" }

    mockAuthSuccess({ role: "VENDEDOR" })
    mockSupabaseFrom({ organizations: createChainMock(orgAR) })
    expect((await parseResponse(await GET())).body.facturacionElectronicaDisponible).toBe(false)

    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({ organizations: createChainMock(orgAR) })
    expect((await parseResponse(await GET())).body.facturacionElectronicaDisponible).toBe(true)
  })

  it("sin tasa propia usa la del país, y sin config cae a los mismos defaults que /api/configuracion", async () => {
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
    expect(body.ivaPorcentaje).toBe(0)
    expect(body.cotizacionValidezDias).toBe(30)
    expect(body.cotizacionTerminos).toBe("")
    expect(body.politicaAbandonoDiasDefault).toBe(60)
    expect(body.anticipoPorcentajeDefault).toBe(50)
    expect(body.umbralStockBajo).toBe(5)
  })

  it("sin sesión responde 401", async () => {
    mockAuthError()
    const res = await GET()
    expect(res.status).toBe(401)
  })
})
