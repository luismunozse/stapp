/**
 * Editar los items de una cotización ACEPTADA en el lugar.
 *
 * Tiene firma del cliente y stock reservado contra sus items, así que el PUT
 * exige que el usuario elija:
 *  - MANTENER: sigue ACEPTADA con la firma; la reserva se concilia con los
 *    items nuevos y, si no hay stock, los items vuelven a ser los de antes.
 *  - PEDIR_FIRMA: firma borrada, reserva liberada y vuelve a ENVIADA.
 * Una ya convertida (venta u orden), reemplazada o del catálogo no se edita.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
}))
vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({ update: vi.fn().mockResolvedValue(undefined) })),
}))

import { PUT } from "@/app/api/cotizaciones/[id]/route"

const aceptada = {
  id: "cot-1",
  estado: "ACEPTADA",
  tipo: "ORDEN",
  origen: null,
  organization_id: "org-1",
  created_by: "user-1",
  iva_porcentaje: 0,
  descuento_global_tipo: "porcentaje",
  descuento_global_valor: 0,
  orden_id: null,
  venta_id: null,
  convertida_a_orden_id: null,
  reemplazada_por: null,
  fecha_vencimiento: "2020-01-01T12:00:00Z",
  numero_cotizacion: "COT-001",
  total: 100,
  items_cotizacion: [{ id: "it-1" }],
}

const itemsViejos = [{ id: "it-1", cotizacion_id: "cot-1", descripcion: "Viejo", cantidad: 1, precio_unitario: 100 }]

/** cotizaciones: .single() devuelve la fila; el UPDATE condicional (.select("id")) devuelve `reclamo`. */
function cotizacionesChain(row: Record<string, unknown>, reclamo: unknown[] = [{ id: "cot-1" }]) {
  const chain = createChainMock(reclamo)
  chain.single = vi.fn().mockResolvedValue({ data: row, error: null })
  return chain
}

const put = (body: Record<string, unknown>) =>
  PUT(
    new Request("http://localhost:3000/api/cotizaciones/cot-1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "cot-1" }) }
  )

const items = [{ descripcion: "Nuevo", cantidad: 2, precioUnitario: 80 }]

describe("PUT /api/cotizaciones/[id] — editar una ACEPTADA", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: null } as any)
  })

  it("sin elegir el modo se rechaza y no toca nada", async () => {
    const itemsChain = createChainMock(itemsViejos)
    mockSupabaseFrom({ cotizaciones: cotizacionesChain(aceptada), items_cotizacion: itemsChain })

    const { status, body } = await parseResponse(await put({ items }))

    expect(status).toBe(400)
    expect(body.error).toMatch(/firmarla de nuevo/i)
    expect(itemsChain.delete).not.toHaveBeenCalled()
  })

  it.each([
    [{ venta_id: "v-1" }, /venta/i],
    [{ convertida_a_orden_id: "o-1" }, /orden/i],
    [{ reemplazada_por: "rev-1" }, /reemplazada/i],
    [{ origen: "CATALOGO_PUBLICO" }, /catálogo/i],
  ])("no se edita si %o", async (extra, mensaje) => {
    const itemsChain = createChainMock(itemsViejos)
    mockSupabaseFrom({ cotizaciones: cotizacionesChain({ ...aceptada, ...extra }), items_cotizacion: itemsChain })

    const { status, body } = await parseResponse(await put({ items, modoAceptada: "MANTENER" }))

    expect(status).toBe(400)
    expect(body.error).toMatch(mensaje)
    expect(itemsChain.delete).not.toHaveBeenCalled()
  })

  it("MANTENER: reemplaza los items, sigue ACEPTADA y concilia la reserva", async () => {
    const cotChain = cotizacionesChain(aceptada)
    const itemsChain = createChainMock(itemsViejos)
    mockSupabaseFrom({ cotizaciones: cotChain, items_cotizacion: itemsChain })

    const { status } = await parseResponse(await put({ items, modoAceptada: "MANTENER", fechaVencimiento: "2020-01-01" }))

    expect(status).toBe(200)
    expect(itemsChain.insert).toHaveBeenCalledWith([expect.objectContaining({ descripcion: "Nuevo", cantidad: 2 })])
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("reservar_items_cotizacion", expect.objectContaining({ p_cotizacion_id: "cot-1" }))
    expect(supabaseAdmin.rpc).not.toHaveBeenCalledWith("liberar_items_cotizacion", expect.anything())
    // Ningún UPDATE cambia el estado ni la firma.
    for (const [patch] of cotChain.update.mock.calls) {
      expect(patch).not.toHaveProperty("estado")
      expect(patch).not.toHaveProperty("firma_aprobacion")
      // El vencimiento viejo del formulario no se valida ni se escribe.
      expect(patch).not.toHaveProperty("fecha_vencimiento")
    }
  })

  it("MANTENER sin stock: restaura los items anteriores y responde 409", async () => {
    const cotChain = cotizacionesChain(aceptada)
    const itemsChain = createChainMock(itemsViejos)
    mockSupabaseFrom({ cotizaciones: cotChain, items_cotizacion: itemsChain })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: "P0003", message: "Stock insuficiente para Nuevo" },
    } as any)

    const { status, body } = await parseResponse(await put({ items, modoAceptada: "MANTENER" }))

    expect(status).toBe(409)
    expect(body.error).toMatch(/quedó como estaba/i)
    expect(itemsChain.insert).toHaveBeenLastCalledWith(itemsViejos)
    // Los totales de la cotización no se actualizan.
    expect(cotChain.update).not.toHaveBeenCalled()
  })

  it("PEDIR_FIRMA: borra la firma, vuelve a ENVIADA con vencimiento vigente y libera la reserva", async () => {
    const cotChain = cotizacionesChain(aceptada)
    const itemsChain = createChainMock(itemsViejos)
    const orgChain = createChainMock({ cotizacion_validez_dias: 15 })
    mockSupabaseFrom({ cotizaciones: cotChain, items_cotizacion: itemsChain, organizations: orgChain })

    const { status } = await parseResponse(await put({ items, modoAceptada: "PEDIR_FIRMA", fechaVencimiento: "2020-01-01" }))

    expect(status).toBe(200)
    const reclamo = cotChain.update.mock.calls[0][0]
    expect(reclamo).toEqual(
      expect.objectContaining({ estado: "ENVIADA", firma_aprobacion: null, firma_mime: null, fecha_aprobacion: null })
    )
    expect(new Date(reclamo.fecha_vencimiento).getTime()).toBeGreaterThan(Date.now())
    // Condicionado a que siga ACEPTADA y sin venta.
    expect(cotChain.eq).toHaveBeenCalledWith("estado", "ACEPTADA")
    expect(cotChain.is).toHaveBeenCalledWith("venta_id", null)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("liberar_items_cotizacion", expect.objectContaining({ p_cotizacion_id: "cot-1" }))
    expect(supabaseAdmin.rpc).not.toHaveBeenCalledWith("reservar_items_cotizacion", expect.anything())
    // El UPDATE posterior no vuelve a escribir el vencimiento vencido.
    for (const [patch] of cotChain.update.mock.calls.slice(1)) {
      expect(patch).not.toHaveProperty("fecha_vencimiento")
    }
  })

  it("PEDIR_FIRMA: si en el medio dejó de estar ACEPTADA, 409 sin tocar items ni reserva", async () => {
    const itemsChain = createChainMock(itemsViejos)
    mockSupabaseFrom({
      cotizaciones: cotizacionesChain(aceptada, []),
      items_cotizacion: itemsChain,
      organizations: createChainMock({ cotizacion_validez_dias: 30 }),
    })

    const { status } = await parseResponse(await put({ items, modoAceptada: "PEDIR_FIRMA" }))

    expect(status).toBe(409)
    expect(itemsChain.delete).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("un PRESUPUESTO aceptado nunca reservó: no concilia ni libera stock", async () => {
    mockSupabaseFrom({
      cotizaciones: cotizacionesChain({ ...aceptada, tipo: "PRESUPUESTO" }),
      items_cotizacion: createChainMock(itemsViejos),
      organizations: createChainMock({ cotizacion_validez_dias: 30 }),
    })

    await put({ items, modoAceptada: "MANTENER" })
    await put({ items, modoAceptada: "PEDIR_FIRMA" })

    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("una RECHAZADA sigue sin poder editarse", async () => {
    const itemsChain = createChainMock(itemsViejos)
    mockSupabaseFrom({ cotizaciones: cotizacionesChain({ ...aceptada, estado: "RECHAZADA" }), items_cotizacion: itemsChain })

    const { status } = await parseResponse(await put({ items, modoAceptada: "MANTENER" }))

    expect(status).toBe(400)
    expect(itemsChain.delete).not.toHaveBeenCalled()
  })
})
