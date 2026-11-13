import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"

// El total de una orden es la base de la comisión del técnico. No se bloquea
// quién lo cambia, pero cada cambio queda en el historial interno de la orden
// (orden_eventos TOTAL_MODIFICADO) con quién, desde cuánto y hasta cuánto.

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({ update: vi.fn().mockResolvedValue(undefined) })),
  diffObjects: vi.fn().mockReturnValue({ before: {}, after: {} }),
}))
vi.mock("@/lib/notifications/queue", () => ({ queueNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/webhooks/dispatcher", () => ({ emitWebhookEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/tipos-dispositivo-config", () => ({ tipoValidaImei: vi.fn(async () => false) }))

import { supabaseAdmin } from "@/lib/supabase"
import { POST } from "@/app/api/ordenes/[id]/entregar/route"
import { PUT } from "@/app/api/ordenes/[id]/route"
import { describirCambioTotal, TIPO_EVENTO_CAMBIO_TOTAL } from "@/lib/ordenes/cambio-total"

const params = { params: Promise.resolve({ id: "o1" }) }

function eventosDeTotal(eventos: any) {
  return eventos.insert.mock.calls
    .map((c: any[]) => c[0])
    .filter((row: any) => row.tipo === TIPO_EVENTO_CAMBIO_TOTAL)
}

describe("describirCambioTotal", () => {
  it("describe el cambio con los dos montos", () => {
    expect(describirCambioTotal("10000", 12500, "EDICION")).toEqual({
      antes: 10000,
      despues: 12500,
      descripcion: "Total cambiado: de $10.000 a $12.500",
    })
  })

  it("marca cuando fue al entregar y muestra 'sin total' si no había", () => {
    expect(describirCambioTotal(null, 8000, "ENTREGA")?.descripcion).toBe(
      "Total cambiado al entregar: de sin total a $8.000"
    )
  })

  it("no registra nada si el total no cambió (string de la base vs number)", () => {
    expect(describirCambioTotal("25000.00", 25000, "EDICION")).toBeNull()
    expect(describirCambioTotal(null, 0, "EDICION")).toBeNull()
  })
})

describe("POST /api/ordenes/[id]/entregar — registra el cambio de total", () => {
  const ordenBase = {
    id: "o1",
    estado: "REPARADO",
    organization_id: "org-1",
    sucursal_id: "suc-1",
    cliente_id: "c1",
    numero_orden: 7,
    codigo_orden: "ORD-7",
    tecnico_id: null,
    costo_final: "20000",
    descuento_cobro: "0",
    total_cobrado: "0",
    fecha_completado: null,
  }

  function mockEntrega() {
    const ordenes = createChainMock({ ...ordenBase, estado: "ENTREGADO", users: null })
    const eventos = createChainMock(null)
    mockSupabaseFrom({
      ordenes_servicio: ordenes,
      repuestos_orden: createChainMock([]),
      organizations: createChainMock({ nombre: "Taller", zona_horaria: "America/Argentina/Buenos_Aires" }),
      garantias: createChainMock(null),
      orden_eventos: eventos,
    })
    ;(ordenes as any).single.mockResolvedValueOnce({ data: ordenBase, error: null })
    return eventos
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { success: true }, error: null } as any)
  })

  it("si el total confirmado es distinto, deja quién, desde cuánto y hasta cuánto", async () => {
    mockAuthSuccess({ userId: "user-1" })
    const eventos = mockEntrega()

    const res = await POST(createPostRequest({ totalACobrar: 26000, incluyeRepuestos: true }), params)

    expect((await parseResponse(res)).status).toBe(200)
    const registrados = eventosDeTotal(eventos)
    expect(registrados).toHaveLength(1)
    expect(registrados[0]).toMatchObject({
      orden_id: "o1",
      organization_id: "org-1",
      descripcion: "Total cambiado al entregar: de $20.000 a $26.000",
      metadata: { antes: 20000, despues: 26000, origen: "ENTREGA", rol: "ADMIN" },
      created_by: "user-1",
    })
  })

  it("si confirma el mismo total no registra nada", async () => {
    mockAuthSuccess()
    const eventos = mockEntrega()

    const res = await POST(createPostRequest({ totalACobrar: 20000, incluyeRepuestos: true }), params)

    expect((await parseResponse(res)).status).toBe(200)
    expect(eventosDeTotal(eventos)).toHaveLength(0)
  })

  it("si no confirma un total no registra nada", async () => {
    mockAuthSuccess()
    const eventos = mockEntrega()

    const res = await POST(createPostRequest({}), params)

    expect((await parseResponse(res)).status).toBe(200)
    expect(eventosDeTotal(eventos)).toHaveLength(0)
  })
})

describe("PUT /api/ordenes/[id] — registra el cambio de total", () => {
  const ORDEN = {
    id: "o1",
    numero_orden: 1,
    codigo_orden: "CEL-001",
    cliente_id: "c1",
    tecnico_id: "t1",
    organization_id: "org-1",
    tipo_dispositivo: "CELULAR",
    dispositivo: "iPhone 13",
    estado: "EN_REPARACION",
    costo_final: "15000",
    presupuesto: "15000",
    descuento_cobro: "0",
    total_cobrado: "0",
    clientes: { id: "c1", nombre: "Juan", email: "j@test.com", telefono: "123" },
    organizations: { id: "org-1", nombre: "Taller", moneda: "ARS", zona_horaria: "America/Argentina/Buenos_Aires" },
  }

  const put = (body: unknown) =>
    PUT(
      new Request("http://localhost:3000/api/ordenes/o1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      params
    )

  function mockOrden() {
    const chain = createChainMock(null)
    chain.single = vi.fn().mockImplementation(() => Promise.resolve({ data: { ...ORDEN }, error: null }))
    const eventos = createChainMock(null)
    mockSupabaseFrom({ ordenes_servicio: chain, orden_eventos: eventos })
    return eventos
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it("editar el costo final lo registra con el monto anterior", async () => {
    const eventos = mockOrden()

    const res = await put({ costoFinal: 18000 })

    expect((await parseResponse(res)).status).toBe(200)
    const registrados = eventosDeTotal(eventos)
    expect(registrados).toHaveLength(1)
    expect(registrados[0]).toMatchObject({
      descripcion: "Total cambiado: de $15.000 a $18.000",
      metadata: { antes: 15000, despues: 18000, origen: "EDICION" },
    })
  })

  it("reenviar el mismo costo final no registra nada", async () => {
    const eventos = mockOrden()

    const res = await put({ costoFinal: 15000, observaciones: "x" })

    expect((await parseResponse(res)).status).toBe(200)
    expect(eventosDeTotal(eventos)).toHaveLength(0)
  })
})
