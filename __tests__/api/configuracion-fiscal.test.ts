// @vitest-environment node
/**
 * Covers GET/PUT of the six fiscal identity + collection fields added by
 * migration 295 (cuit, condicion_iva, domicilio_fiscal, cbu_alias,
 * medios_pago_texto, plazo_pago_dias) — RC Task 6. Follows the same
 * mock pattern as configuracion-terminologia.test.ts.
 *
 * Also covers graceful degradation: the migration is not applied on every
 * environment yet, so a PGRST204 on the new columns must not break the rest
 * of GET/PUT (same defensive tier the route already uses for
 * recepcion_terminos / iva_regimen / etc).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"

function baseOrgRow(overrides: Record<string, any> = {}) {
  return {
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
    ...overrides,
  }
}

describe("/api/configuracion — datos fiscales y de cobro", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it("GET returns the six fiscal fields when present on the org row", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const orgData = baseOrgRow({
      cuit: "30-71234567-8",
      condicion_iva: "Responsable Inscripto",
      domicilio_fiscal: "Av. Siempreviva 742",
      cbu_alias: "taller.alias.mp",
      medios_pago_texto: "Efectivo, transferencia",
      plazo_pago_dias: 15,
    })
    mockSupabaseFrom({ organizations: createChainMock(orgData) })
    const { GET } = await import("@/app/api/configuracion/route")
    const res = await GET()
    const { status, body } = await parseResponse(res as Response)

    expect(status).toBe(200)
    expect(body.cuit).toBe("30-71234567-8")
    expect(body.condicionIva).toBe("Responsable Inscripto")
    expect(body.domicilioFiscal).toBe("Av. Siempreviva 742")
    expect(body.cbuAlias).toBe("taller.alias.mp")
    expect(body.mediosPagoTexto).toBe("Efectivo, transferencia")
    expect(body.plazoPagoDias).toBe(15)
  })

  it("GET defaults the fiscal fields to empty/null when absent on the org row", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    mockSupabaseFrom({ organizations: createChainMock(baseOrgRow()) })
    const { GET } = await import("@/app/api/configuracion/route")
    const res = await GET()
    const { body } = await parseResponse(res as Response)

    expect(body.cuit).toBe("")
    expect(body.condicionIva).toBe("")
    expect(body.domicilioFiscal).toBe("")
    expect(body.cbuAlias).toBe("")
    expect(body.mediosPagoTexto).toBe("")
    expect(body.plazoPagoDias).toBeNull()
  })

  it("GET degrades gracefully when migration 295 hasn't run (PGRST204 on the fiscal select), still returning the rest of the config", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const orgData = baseOrgRow()
    const chain = createChainMock()
    chain.single = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { code: "PGRST204" } })
      .mockResolvedValueOnce({ data: orgData, error: null })
    mockSupabaseFrom({ organizations: chain })

    const { GET } = await import("@/app/api/configuracion/route")
    const res = await GET()
    const { status, body } = await parseResponse(res as Response)

    expect(status).toBe(200)
    expect(body.nombreEmpresa).toBe("Test Org")
    expect(body.cuit).toBe("")
    expect(body.plazoPagoDias).toBeNull()
  })

  it("PUT persists the six fiscal fields", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const updatedRow = baseOrgRow({
      cuit: "30-71234567-8",
      condicion_iva: "Monotributo",
      domicilio_fiscal: "Calle Falsa 123",
      cbu_alias: "mi.alias",
      medios_pago_texto: "Efectivo",
      plazo_pago_dias: 30,
    })
    mockSupabaseFrom({ organizations: createChainMock(updatedRow) })

    const { PUT } = await import("@/app/api/configuracion/route")
    const request = new Request("http://localhost:3000/api/configuracion", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cuit: "30-71234567-8",
        condicionIva: "Monotributo",
        domicilioFiscal: "Calle Falsa 123",
        cbuAlias: "mi.alias",
        mediosPagoTexto: "Efectivo",
        plazoPagoDias: "30",
      }),
    })
    const res = await PUT(request)
    const { status, body } = await parseResponse(res as Response)

    expect(status).toBe(200)
    expect(body.cuit).toBe("30-71234567-8")
    expect(body.condicionIva).toBe("Monotributo")
    expect(body.domicilioFiscal).toBe("Calle Falsa 123")
    expect(body.cbuAlias).toBe("mi.alias")
    expect(body.mediosPagoTexto).toBe("Efectivo")
    expect(body.plazoPagoDias).toBe(30)
  })

  it("PUT rejects an unknown condicionIva value (leaves it unset)", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const chain = createChainMock(baseOrgRow())
    mockSupabaseFrom({ organizations: chain })

    const { PUT } = await import("@/app/api/configuracion/route")
    const request = new Request("http://localhost:3000/api/configuracion", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      // telefono is included so updateData isn't empty (an empty updateData
      // takes the no-op "return current state" branch, which never calls
      // .update() at all — see the empty-updateData test below).
      body: JSON.stringify({ telefono: "123", condicionIva: "Cosa Inventada" }),
    })
    const res = await PUT(request)
    const { status } = await parseResponse(res as Response)

    expect(status).toBe(200)
    expect(chain.update).toHaveBeenCalledWith(
      expect.not.objectContaining({ condicion_iva: expect.anything() })
    )
  })

  it("PUT clears plazoPagoDias to null on empty string", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const chain = createChainMock(baseOrgRow({ plazo_pago_dias: null }))
    mockSupabaseFrom({ organizations: chain })

    const { PUT } = await import("@/app/api/configuracion/route")
    const request = new Request("http://localhost:3000/api/configuracion", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plazoPagoDias: "" }),
    })
    await PUT(request)

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ plazo_pago_dias: null })
    )
  })

  it("PUT degrades gracefully when migration 295 hasn't run (PGRST204 on the fiscal columns), still persisting the rest of the update", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const chain = createChainMock()
    chain.single = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { code: "PGRST204" } })
      .mockResolvedValueOnce({ data: baseOrgRow({ telefono: "123456" }), error: null })
    mockSupabaseFrom({ organizations: chain })

    const { PUT } = await import("@/app/api/configuracion/route")
    const request = new Request("http://localhost:3000/api/configuracion", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telefono: "123456", cuit: "30-71234567-8" }),
    })
    const res = await PUT(request)
    const { status, body } = await parseResponse(res as Response)

    expect(status).toBe(200)
    expect(body.telefono).toBe("123456")
  })
})
