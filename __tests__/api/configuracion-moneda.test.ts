import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"
import { GET, PUT } from "@/app/api/configuracion/moneda/route"

const orgAR = { pais: "AR", moneda: "ARS" }
const orgCL = { pais: "CL", moneda: "CLP" }

function put(body: unknown) {
  return PUT(
    new Request("http://localhost:3000/api/configuracion/moneda", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  )
}

const base = { habilitada: true, monedaExtranjera: "USD", fuente: "BLUE", tipoCambioManual: null, redondeoConversion: 10 }

function setup(opts: { org?: any; fila?: any; filaError?: any; upsertError?: any } = {}) {
  const org = createChainMock(opts.org ?? orgAR)
  const moneda = createChainMock(opts.fila ?? null, opts.filaError ?? null)
  if (opts.upsertError) moneda.upsert.mockReturnValue(createChainMock(null, opts.upsertError))
  const inventario = createChainMock(null, null, 3)
  const servicios = createChainMock(null, null, 2)
  mockSupabaseFrom({ organizations: org, organizacion_moneda: moneda, inventario, servicios })
  return { org, moneda, inventario, servicios }
}

describe("/api/configuracion/moneda", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
  })

  describe("GET", () => {
    it("ADMIN recibe config y el conteo de ítems en divisa", async () => {
      const { inventario, servicios } = setup()
      const { status, body } = await parseResponse(await GET())
      expect(status).toBe(200)
      expect(body.config.monedaLocal).toBe("ARS")
      expect(body.itemsEnDivisa).toEqual({ inventario: 3, servicios: 2 })
      expect(inventario.select).toHaveBeenCalledWith("id", { count: "exact", head: true })
      expect(inventario.eq).toHaveBeenCalledWith("organization_id", "org-1")
      expect(inventario.not).toHaveBeenCalledWith("moneda", "is", null)
      expect(servicios.not).toHaveBeenCalledWith("moneda", "is", null)
    })

    it("un VENDEDOR recibe config pero itemsEnDivisa null", async () => {
      mockAuthSuccess({ role: "VENDEDOR" })
      const { inventario } = setup()
      const { status, body } = await parseResponse(await GET())
      expect(status).toBe(200)
      expect(body.itemsEnDivisa).toBeNull()
      expect(inventario.select).not.toHaveBeenCalled()
    })

    it("con la tabla faltante (42P01) devuelve habilitada false", async () => {
      setup({ filaError: { code: "42P01", message: "no table" } })
      const { status, body } = await parseResponse(await GET())
      expect(status).toBe(200)
      expect(body.config.habilitada).toBe(false)
    })

    it("si la columna moneda no existe (42703) cuenta 0", async () => {
      const s = setup()
      s.inventario = createChainMock(null, { code: "42703", message: "no col" })
      mockSupabaseFrom({ organizations: createChainMock(orgAR), organizacion_moneda: createChainMock(null), inventario: s.inventario, servicios: createChainMock(null, null, 2) })
      const { body } = await parseResponse(await GET())
      expect(body.itemsEnDivisa).toEqual({ inventario: 0, servicios: 2 })
    })

    it("un error inesperado responde 500", async () => {
      setup({ filaError: { code: "XX000", message: "boom" } })
      vi.spyOn(console, "error").mockImplementation(() => {})
      const { status, body } = await parseResponse(await GET())
      expect(status).toBe(500)
      expect(body).toEqual({ error: "Error al obtener la configuración de moneda" })
    })
  })

  describe("PUT", () => {
    it("VENDEDOR recibe 403", async () => {
      mockAuthSuccess({ role: "VENDEDOR" })
      setup()
      const { status } = await parseResponse(await put(base))
      expect(status).toBe(403)
    })

    it("moneda extranjera igual a la local es 400", async () => {
      setup({ org: { pais: "US", moneda: "USD" } })
      const { status, body } = await parseResponse(await put({ ...base, fuente: "MANUAL", tipoCambioManual: 1000 }))
      expect(status).toBe(400)
      expect(body.error).toBe("La moneda extranjera no puede ser la misma que la moneda local.")
    })

    it("fuente no disponible: CL + BLUE y AR + EUR + MEP son 400", async () => {
      setup({ org: orgCL })
      expect((await put({ ...base, fuente: "BLUE", redondeoConversion: 0 })).status).toBe(400)
      setup({ org: orgAR })
      expect((await put({ ...base, monedaExtranjera: "EUR", fuente: "MEP" })).status).toBe(400)
    })

    it.each([["1.250,50"], ["1e3"], [0], [1250.1234567]])("MANUAL con %s es 400 con el mensaje de validarTipoCambio", async (v) => {
      const { moneda } = setup({ org: orgCL })
      const { status, body } = await parseResponse(await put({ ...base, fuente: "MANUAL", tipoCambioManual: v, redondeoConversion: 0 }))
      expect(status).toBe(400)
      expect(typeof body.error).toBe("string")
      expect(body.error).toMatch(/^El tipo de cambio/)
      expect(moneda.upsert).not.toHaveBeenCalled()
    })

    it("MANUAL sin tipo de cambio es 400", async () => {
      setup({ org: orgCL })
      const { status } = await parseResponse(await put({ ...base, fuente: "MANUAL", redondeoConversion: 0 }))
      expect(status).toBe(400)
    })

    it("MANUAL con '1250.5' guarda 1250.5", async () => {
      const { moneda } = setup({ org: orgCL })
      const { status, body } = await parseResponse(await put({ ...base, fuente: "MANUAL", tipoCambioManual: "1250.5", redondeoConversion: 0 }))
      expect(status).toBe(200)
      expect(body).toHaveProperty("config")
      expect(body.itemsEnDivisa).toEqual({ inventario: 3, servicios: 2 })
      const [payload, opts] = moneda.upsert.mock.calls[0]
      expect(payload.tipo_cambio_manual).toBe(1250.5)
      expect(payload.organization_id).toBe("org-1")
      expect(opts).toEqual({ onConflict: "organization_id" })
    })

    it("redondeoConversion 5 es 400", async () => {
      setup()
      const { status } = await parseResponse(await put({ ...base, redondeoConversion: 5 }))
      expect(status).toBe(400)
    })

    it("sin cambio de moneda ni fuente no toca la referencia ni los campos de efectivo", async () => {
      const { moneda } = setup({ fila: { moneda_extranjera: "USD", tipo_cambio_fuente: "BLUE", acepta_usd_efectivo: true } })
      const { status } = await parseResponse(await put(base))
      expect(status).toBe(200)
      const payload = moneda.upsert.mock.calls[0][0]
      expect(payload).not.toHaveProperty("tipo_cambio_referencia")
      expect(payload).not.toHaveProperty("referencia_en")
      expect(payload).not.toHaveProperty("acepta_usd_efectivo")
      expect(payload).not.toHaveProperty("vuelto_moneda_default")
      expect(payload).toMatchObject({ multimoneda_habilitada: true, moneda_extranjera: "USD", tipo_cambio_fuente: "BLUE", tipo_cambio_manual: null, redondeo_conversion: 10 })
    })

    it("si cambia la fuente borra la referencia", async () => {
      const { moneda } = setup({ fila: { moneda_extranjera: "USD", tipo_cambio_fuente: "OFICIAL", tipo_cambio_referencia: 900 } })
      await put(base)
      expect(moneda.upsert.mock.calls[0][0]).toMatchObject({ tipo_cambio_referencia: null, referencia_en: null })
    })

    it("si cambia la moneda extranjera borra la referencia", async () => {
      const { moneda } = setup({ fila: { moneda_extranjera: "USD", tipo_cambio_fuente: "OFICIAL", tipo_cambio_referencia: 900 } })
      await put({ ...base, monedaExtranjera: "EUR", fuente: "OFICIAL" })
      expect(moneda.upsert.mock.calls[0][0]).toMatchObject({ tipo_cambio_referencia: null, referencia_en: null })
    })

    it("con la tabla faltante en el upsert responde 503", async () => {
      setup({ upsertError: { code: "42P01", message: "no table" } })
      const { status, body } = await parseResponse(await put(base))
      expect(status).toBe(503)
      expect(body).toEqual({ error: "Falta aplicar la migración de multimoneda" })
    })

    it("otro error del upsert responde 500", async () => {
      setup({ upsertError: { code: "XX000", message: "boom" } })
      vi.spyOn(console, "error").mockImplementation(() => {})
      const { status, body } = await parseResponse(await put(base))
      expect(status).toBe(500)
      expect(body).toEqual({ error: "Error al guardar la configuración de moneda" })
    })
  })
})
