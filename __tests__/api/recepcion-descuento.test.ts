/**
 * PATCH /api/recepciones/[id] — edit batch discount.
 *
 * Same mock style and gate as recepcion-detalle.test.ts (GET on the same
 * route module). Discount edits are pricing edits, so they are ADMIN-only
 * regardless of the general recepcion-multiple feature gate.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn(),
}))

import { hasPlanFeature } from "@/lib/subscriptions"
import { PATCH } from "@/app/api/recepciones/[id]/route"

function createParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function createPatchRequest(body: any, url: string = "http://localhost:3000/api/recepciones/rec-1"): Request {
  return new Request(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("PATCH /api/recepciones/[id] — editar descuento de lote", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
    vi.mocked(hasPlanFeature).mockResolvedValue(true)
  })

  it("devuelve 403 FEATURE_REQUIRED cuando el plan no tiene la feature", async () => {
    vi.mocked(hasPlanFeature).mockResolvedValue(false)

    const res = await PATCH(
      createPatchRequest({ descuentoTipo: "porcentaje", descuentoValor: 10 }),
      createParams("rec-1"),
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(403)
    expect(body.code).toBe("FEATURE_REQUIRED")
    expect(body.feature).toBe("recepcion_multiple")
  })

  it("devuelve 403 cuando el rol no es ADMIN (editar el descuento es editar precios)", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })

    const res = await PATCH(
      createPatchRequest({ descuentoTipo: "porcentaje", descuentoValor: 10 }),
      createParams("rec-1"),
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(403)
    expect(body.error).toBeTruthy()
  })

  it("devuelve 400 cuando el tipo esta seteado sin valor", async () => {
    const res = await PATCH(
      createPatchRequest({ descuentoTipo: "porcentaje", descuentoValor: null }),
      createParams("rec-1"),
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toBeTruthy()
  })

  it("devuelve 400 cuando el porcentaje supera 100", async () => {
    const res = await PATCH(
      createPatchRequest({ descuentoTipo: "porcentaje", descuentoValor: 150 }),
      createParams("rec-1"),
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toBeTruthy()
  })

  it("devuelve 400 cuando el valor es <= 0", async () => {
    const res = await PATCH(
      createPatchRequest({ descuentoTipo: "monto", descuentoValor: 0 }),
      createParams("rec-1"),
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toBeTruthy()
  })

  it("devuelve 409 cuando alguna orden del lote ya esta en un estado entregado", async () => {
    mockSupabaseFrom({
      ordenes_servicio: createChainMock([{ id: "o1" }]),
    })

    const res = await PATCH(
      createPatchRequest({ descuentoTipo: "monto", descuentoValor: 500 }),
      createParams("rec-1"),
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(409)
    expect(body.error).toBeTruthy()
  })

  it("devuelve 500 cuando falla la actualizacion por un error real de DB", async () => {
    mockSupabaseFrom({
      ordenes_servicio: createChainMock([]),
      recepciones: createChainMock(null, { code: "500", message: "connection reset" }),
    })

    const res = await PATCH(
      createPatchRequest({ descuentoTipo: "monto", descuentoValor: 500 }),
      createParams("rec-1"),
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(500)
    expect(body.error).toBeTruthy()
  })

  it("persiste descuento_tipo/descuento_valor y devuelve 200", async () => {
    mockSupabaseFrom({
      ordenes_servicio: createChainMock([]),
      recepciones: createChainMock([{ id: "rec-1" }]),
    })

    const res = await PATCH(
      createPatchRequest({ descuentoTipo: "monto", descuentoValor: 500 }),
      createParams("rec-1"),
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
  })

  it("acepta {null, null} para limpiar el descuento y devuelve 200", async () => {
    mockSupabaseFrom({
      ordenes_servicio: createChainMock([]),
      recepciones: createChainMock([{ id: "rec-1" }]),
    })

    const res = await PATCH(
      createPatchRequest({ descuentoTipo: null, descuentoValor: null }),
      createParams("rec-1"),
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
  })
})
