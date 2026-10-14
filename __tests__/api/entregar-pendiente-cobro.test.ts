import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({ update: vi.fn().mockResolvedValue(undefined) })),
  diffObjects: vi.fn().mockReturnValue({ before: {}, after: {} }),
}))

vi.mock("@/lib/notifications/queue", () => ({
  queueNotification: vi.fn().mockResolvedValue(undefined),
}))

import { supabaseAdmin } from "@/lib/supabase"
import { diffObjects } from "@/lib/audit"
import { POST } from "@/app/api/ordenes/[id]/entregar/route"

function createParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

const ordenBase = {
  id: "o1",
  estado: "REPARADO",
  organization_id: "org-1",
  sucursal_id: "suc-1",
  cliente_id: "c1",
  numero_orden: 7,
  codigo_orden: "ORD-7",
  tecnico_id: null,
  costo_final: "0",
  descuento_cobro: "0",
  total_cobrado: "0",
  fecha_completado: null,
}

/** `entregada` son los valores con los que queda la orden tras el UPDATE. */
function mockEntrega(entregada: Record<string, unknown>, repuestos: any[] = []) {
  const ordenes = createChainMock({ ...ordenBase, ...entregada, estado: "ENTREGADO", users: null })
  mockSupabaseFrom({
    ordenes_servicio: ordenes,
    repuestos_orden: createChainMock(repuestos),
    organizations: createChainMock({ nombre: "Taller", zona_horaria: "America/Argentina/Buenos_Aires" }),
    garantias: createChainMock(null),
    orden_eventos: createChainMock(null),
  })
  ;(ordenes as any).single.mockResolvedValueOnce({ data: ordenBase, error: null })
  return ordenes
}

describe("POST /api/ordenes/[id]/entregar — devuelve el saldo para encadenar el cobro", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { success: true }, error: null } as any)
  })

  it("devuelve el pendiente descontando lo ya cobrado y el descuento", async () => {
    mockAuthSuccess()
    mockEntrega({ costo_final: "100000", descuento_cobro: "5000", total_cobrado: "20000" })

    const res = await POST(createPostRequest({}), createParams("o1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.pendienteCobro).toBe(75000)
  })

  it("devuelve 0 cuando la orden ya estaba cobrada", async () => {
    mockAuthSuccess()
    mockEntrega({ costo_final: "50000", descuento_cobro: "0", total_cobrado: "50000" })

    const res = await POST(createPostRequest({}), createParams("o1"))
    expect((await parseResponse(res)).body.pendienteCobro).toBe(0)
  })

  it("devuelve 0 en una entrega sin cobro, aunque haya costo cargado", async () => {
    mockAuthSuccess()
    mockEntrega({ costo_final: "80000", descuento_cobro: "0", total_cobrado: "0" })

    const res = await POST(createPostRequest({ sinCobro: true }), createParams("o1"))
    expect((await parseResponse(res)).body.pendienteCobro).toBe(0)
  })

  it("refleja el total confirmado en la entrega, no el que traia la orden", async () => {
    mockAuthSuccess()
    // La orden venia con costo_final 0; en la entrega se confirman 50000 de mano
    // de obra + 10000 de repuestos a precio de venta.
    mockEntrega(
      { costo_final: "60000", descuento_cobro: "0", total_cobrado: "0" },
      [{ cantidad: 2, precio_unitario: "1000", precio_venta_unitario: "5000" }]
    )

    const res = await POST(
      createPostRequest({ totalACobrar: 50000, incluyeRepuestos: false }),
      createParams("o1")
    )

    expect((await parseResponse(res)).body.pendienteCobro).toBe(60000)
  })

  it("fija el CARGO de hoy: el pendiente entero va a cuenta corriente", async () => {
    mockAuthSuccess()
    mockEntrega({ costo_final: "100000", descuento_cobro: "5000", total_cobrado: "20000" })

    await POST(createPostRequest({}), createParams("o1"))

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "cargar_deuda_cuenta_corriente",
      expect.objectContaining({ p_monto: 75000, p_referencia_id: "o1" })
    )
  })

  it("descuenta del pendiente y del CARGO lo que bajaron las NC activas", async () => {
    mockAuthSuccess()
    const ordenes = mockEntrega({
      costo_final: "100000", descuento_cobro: "5000", total_cobrado: "20000",
      notas_credito: [
        { monto_aplicado_deuda: "15000", anulada: false },
        { monto_aplicado_deuda: "9999", anulada: true },
      ],
    })

    const res = await POST(createPostRequest({}), createParams("o1"))

    expect((await parseResponse(res)).body.pendienteCobro).toBe(60000)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "cargar_deuda_cuenta_corriente",
      expect.objectContaining({ p_monto: 60000, p_referencia_id: "o1" })
    )
    expect(ordenes.select).toHaveBeenCalledWith(expect.stringContaining("notas_credito (monto_aplicado_deuda, anulada)"))
  })

  it("la auditoría no registra el embed de NC como un cambio de la orden", async () => {
    mockAuthSuccess()
    mockEntrega({
      costo_final: "100000", total_cobrado: "20000",
      notas_credito: [{ monto_aplicado_deuda: "0", anulada: false }],
    })

    await POST(createPostRequest({}), createParams("o1"))

    expect(diffObjects).toHaveBeenCalled()
    const [antes, despues] = vi.mocked(diffObjects).mock.calls[0]
    expect(antes).not.toHaveProperty("notas_credito")
    expect(despues).not.toHaveProperty("notas_credito")
  })
})
