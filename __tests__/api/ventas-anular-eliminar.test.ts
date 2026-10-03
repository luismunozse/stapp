import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({
    create: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  })),
}))

import { supabaseAdmin } from "@/lib/supabase"
import { PUT, DELETE } from "@/app/api/ventas/[id]/route"

function req(method: string, body?: any): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request("http://localhost:3000/api/ventas/v1", {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    { params: Promise.resolve({ id: "v1" }) },
  ]
}

const completada = { id: "v1", estado: "COMPLETADA", total: 100, items_venta: [] }
const anulada = { id: "v1", estado: "ANULADA", numero_venta: 3, total: 100 }

describe("PUT /api/ventas/[id] — anular", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
  })

  it("no anula una venta con factura electrónica emitida", async () => {
    const ventas = createChainMock({ ...completada, comprobantes_fiscales: [{ id: "cf", estado: "emitido" }] })
    mockSupabaseFrom({ ventas })
    const { status, body } = await parseResponse(await PUT(...req("PUT", { estado: "ANULADA" })))
    expect(status).toBe(409)
    expect(body.error).toMatch(/nota de crédito/)
    expect(ventas.update).not.toHaveBeenCalled()
  })

  it("no anula con remito vigente; con el remito anulado sí", async () => {
    let ventas = createChainMock({ ...completada, facturas: [{ id: "f1", estado_pago: "PAGADO" }] })
    mockSupabaseFrom({ ventas })
    let res = await parseResponse(await PUT(...req("PUT", { estado: "ANULADA" })))
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/remito vigente/)

    ventas = createChainMock({ ...completada, facturas: [{ id: "f1", estado_pago: "ANULADA" }] })
    mockSupabaseFrom({ ventas })
    res = await parseResponse(await PUT(...req("PUT", { estado: "ANULADA" })))
    expect(res.status).toBe(200)
    expect(ventas.update).toHaveBeenCalledWith({ estado: "ANULADA" })
  })

  it("traduce el P0022 del trigger a 409", async () => {
    const ventas = createChainMock(completada)
    ventas.update = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({
        error: { code: "P0022", message: "VENTA_NO_ANULABLE: La venta tiene un remito vigente: anulalo primero desde Facturación." },
      }),
    })
    mockSupabaseFrom({ ventas })
    const { status, body } = await parseResponse(await PUT(...req("PUT", { estado: "ANULADA" })))
    expect(status).toBe(409)
    expect(body.error).toBe("No se puede anular: La venta tiene un remito vigente: anulalo primero desde Facturación.")
  })
})

describe("DELETE /api/ventas/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
  })

  it("no borra una venta anulada que tiene remito (se perdería la numeración)", async () => {
    const ventas = createChainMock({ ...anulada, facturas: [{ id: "f1", estado_pago: "ANULADA" }] })
    mockSupabaseFrom({ ventas })
    const { status, body } = await parseResponse(await DELETE(...req("DELETE")))
    expect(status).toBe(409)
    expect(body.error).toMatch(/remito/)
    expect(ventas.delete).not.toHaveBeenCalled()
  })

  it("borra los intentos de factura rechazados y después la venta", async () => {
    const ventas = createChainMock({ ...anulada, comprobantes_fiscales: [{ id: "cf", estado: "rechazado" }] })
    const comprobantes = createChainMock(null)
    mockSupabaseFrom({ ventas, comprobantes_fiscales: comprobantes })

    const { status } = await parseResponse(await DELETE(...req("DELETE")))

    expect(status).toBe(200)
    expect(comprobantes.delete).toHaveBeenCalled()
    expect(comprobantes.eq).toHaveBeenCalledWith("estado", "rechazado")
    expect(ventas.delete).toHaveBeenCalled()
  })

  it("si la FK frena el borrado responde 409, no 500", async () => {
    const ventas = createChainMock(anulada)
    ventas.delete = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: { code: "23503", message: "violates foreign key constraint" } }),
    })
    mockSupabaseFrom({ ventas, comprobantes_fiscales: createChainMock(null) })
    const { status } = await parseResponse(await DELETE(...req("DELETE")))
    expect(status).toBe(409)
  })
})
