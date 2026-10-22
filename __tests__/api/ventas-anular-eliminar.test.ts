import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({
    create: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock("@/lib/webhooks/dispatcher", () => ({
  emitWebhookEvent: vi.fn().mockResolvedValue(undefined),
}))

import { supabaseAdmin } from "@/lib/supabase"
import { emitWebhookEvent } from "@/lib/webhooks/dispatcher"
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

// Texto del trigger proteger_anulacion_venta (migracion 371) sin el prefijo del codigo.
const MSG_ANULAR_FACTURA =
  'La venta tiene una factura electrónica emitida: anulala primero con "Anular factura" en el bloque Factura electrónica.'

const factura = (estado: string) => ({ id: `f-${estado}`, estado, cbte_tipo: 6 })
const notaCredito = (estado: string) => ({ id: `nc-${estado}`, estado, cbte_tipo: 8 })

describe("PUT /api/ventas/[id] — anular", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
  })

  it("no anula una venta con factura electrónica emitida: manda a 'Anular factura'", async () => {
    const ventas = createChainMock({ ...completada, comprobantes_fiscales: [{ id: "cf", estado: "emitido" }] })
    mockSupabaseFrom({ ventas })
    const { status, body } = await parseResponse(await PUT(...req("PUT", { estado: "ANULADA" })))
    expect(status).toBe(409)
    expect(body.error).toBe(`No se puede anular: ${MSG_ANULAR_FACTURA}`)
    expect(body.error).toContain('"Anular factura"')
    expect(ventas.update).not.toHaveBeenCalled()
  })

  it("una factura pendiente tampoco deja anular la venta", async () => {
    const ventas = createChainMock({ ...completada, comprobantes_fiscales: [factura("pendiente")] })
    mockSupabaseFrom({ ventas })
    const { status, body } = await parseResponse(await PUT(...req("PUT", { estado: "ANULADA" })))
    expect(status).toBe(409)
    expect(body.error).toContain('"Anular factura"')
    expect(ventas.update).not.toHaveBeenCalled()
  })

  it("con la factura anulada y su nota de crédito emitida sí se anula la venta", async () => {
    const ventas = createChainMock({
      ...completada,
      numero_venta: 9,
      comprobantes_fiscales: [factura("anulado"), notaCredito("emitido")],
    })
    mockSupabaseFrom({ ventas })
    const { status } = await parseResponse(await PUT(...req("PUT", { estado: "ANULADA" })))
    expect(status).toBe(200)
    expect(ventas.update).toHaveBeenCalledWith({ estado: "ANULADA" })
  })

  it("una nota de crédito pendiente con la factura original todavía emitida: la original bloquea", async () => {
    const ventas = createChainMock({ ...completada, comprobantes_fiscales: [factura("emitido"), notaCredito("pendiente")] })
    mockSupabaseFrom({ ventas })
    const { status, body } = await parseResponse(await PUT(...req("PUT", { estado: "ANULADA" })))
    expect(status).toBe(409)
    expect(body.error).toContain('"Anular factura"')
    expect(ventas.update).not.toHaveBeenCalled()
  })

  it("factura #1 anulada con su nota de crédito y factura #2 emitida: la segunda bloquea", async () => {
    const ventas = createChainMock({
      ...completada,
      comprobantes_fiscales: [factura("anulado"), notaCredito("emitido"), { id: "f2", estado: "emitido", cbte_tipo: 6 }],
    })
    mockSupabaseFrom({ ventas })
    const { status } = await parseResponse(await PUT(...req("PUT", { estado: "ANULADA" })))
    expect(status).toBe(409)
    expect(ventas.update).not.toHaveBeenCalled()
  })

  it("la venta se carga con cbte_tipo de los comprobantes (es lo que separa nota de crédito de factura)", async () => {
    const ventas = createChainMock({ ...completada, numero_venta: 9 })
    mockSupabaseFrom({ ventas })
    await PUT(...req("PUT", { estado: "ANULADA" }))
    expect(ventas.select).toHaveBeenCalledWith(expect.stringContaining("comprobantes_fiscales(id, estado, cbte_tipo)"))
  })

  it("traduce el P0022 de la factura (texto de la 371) a 409 sin el prefijo técnico", async () => {
    const ventas = createChainMock(completada)
    ventas.update = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({
        error: { code: "P0022", message: `VENTA_NO_ANULABLE: ${MSG_ANULAR_FACTURA}` },
      }),
    })
    mockSupabaseFrom({ ventas })
    const { status, body } = await parseResponse(await PUT(...req("PUT", { estado: "ANULADA" })))
    expect(status).toBe(409)
    expect(body.error).toBe(`No se puede anular: ${MSG_ANULAR_FACTURA}`)
  })

  it("no anula con remito vigente; con el remito anulado sí", async () => {
    let ventas = createChainMock({ ...completada, facturas: [{ id: "f1", estado_pago: "PAGADO" }] })
    mockSupabaseFrom({ ventas })
    let res = await parseResponse(await PUT(...req("PUT", { estado: "ANULADA" })))
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/remito vigente/)

    ventas = createChainMock({ ...completada, numero_venta: 8, facturas: [{ id: "f1", estado_pago: "ANULADA" }] })
    mockSupabaseFrom({ ventas })
    res = await parseResponse(await PUT(...req("PUT", { estado: "ANULADA" })))
    expect(res.status).toBe(200)
    expect(ventas.update).toHaveBeenCalledWith({ estado: "ANULADA" })
    // avisa a los sistemas externos (antes solo existía venta.completada)
    expect(emitWebhookEvent).toHaveBeenCalledWith("org-1", "venta.anulada", { id: "v1", numeroVenta: 8, total: 100 })
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

  it.each([
    ["factura emitida", [factura("emitido")], /factura electrónica emitida/],
    ["factura pendiente", [factura("pendiente")], /factura electrónica emitida/],
    ["factura anulada con su nota de crédito emitida", [factura("anulado"), notaCredito("emitido")], /numeración/],
    ["factura anulada sola", [factura("anulado")], /numeración/],
    ["nota de crédito pendiente", [notaCredito("pendiente")], /numeración/],
  ])("no borra una venta con %s (no se pierde la numeración fiscal)", async (_n, comprobantes, mensaje) => {
    const ventas = createChainMock({ ...anulada, comprobantes_fiscales: comprobantes })
    const cf = createChainMock(null)
    mockSupabaseFrom({ ventas, comprobantes_fiscales: cf })
    const { status, body } = await parseResponse(await DELETE(...req("DELETE")))
    expect(status).toBe(409)
    expect(body.error).toMatch(mensaje)
    expect(body.error).toMatch(/^No se puede eliminar: /)
    expect(ventas.delete).not.toHaveBeenCalled()
    // ni siquiera los intentos rechazados que la venta pudiera tener: primero se decide, despues se borra
    expect(cf.delete).not.toHaveBeenCalled()
  })

  it("un intento rechazado junto a una factura anulada no se borra: la anulada bloquea antes", async () => {
    const ventas = createChainMock({ ...anulada, comprobantes_fiscales: [factura("anulado"), notaCredito("rechazado")] })
    const cf = createChainMock(null)
    mockSupabaseFrom({ ventas, comprobantes_fiscales: cf })
    const { status } = await parseResponse(await DELETE(...req("DELETE")))
    expect(status).toBe(409)
    expect(cf.delete).not.toHaveBeenCalled()
  })

  it("borra los intentos rechazados de factura y de nota de crédito, y después la venta", async () => {
    const ventas = createChainMock({ ...anulada, comprobantes_fiscales: [factura("rechazado"), notaCredito("rechazado")] })
    const comprobantes = createChainMock(null)
    mockSupabaseFrom({ ventas, comprobantes_fiscales: comprobantes })
    const { status } = await parseResponse(await DELETE(...req("DELETE")))
    expect(status).toBe(200)
    expect(comprobantes.delete).toHaveBeenCalled()
    expect(comprobantes.eq).toHaveBeenCalledWith("estado", "rechazado")
    expect(comprobantes.eq).toHaveBeenCalledWith("venta_id", "v1")
    expect(ventas.delete).toHaveBeenCalled()
  })

  it("la venta se carga con cbte_tipo de los comprobantes", async () => {
    const ventas = createChainMock(anulada)
    mockSupabaseFrom({ ventas, comprobantes_fiscales: createChainMock(null) })
    await DELETE(...req("DELETE"))
    expect(ventas.select).toHaveBeenCalledWith(expect.stringContaining("comprobantes_fiscales(id, estado, cbte_tipo)"))
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
