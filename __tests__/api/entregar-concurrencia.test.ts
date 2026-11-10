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
  tecnico_id: "tec-1",
  costo_final: "100",
  descuento_cobro: "0",
  total_cobrado: "30",
  fecha_completado: null,
  clientes: { id: "c1", nombre: "Juan", email: null, telefono: "1" },
}

/**
 * La primera lectura trae la orden en REPARADO; el UPDATE de la entrega
 * responde con `updateResult`.
 */
function mockEntrega(updateResult: { data: any; error: any }, orden = ordenBase) {
  const ordenes = createChainMock(null)
  ;(ordenes as any).single
    .mockResolvedValueOnce({ data: orden, error: null })
    .mockResolvedValueOnce(updateResult)
  const garantias = createChainMock(null)
  mockSupabaseFrom({
    ordenes_servicio: ordenes,
    repuestos_orden: createChainMock([]),
    organizations: createChainMock({ nombre: "Taller", zona_horaria: "America/Argentina/Buenos_Aires" }),
    garantias,
    orden_eventos: createChainMock(null),
  })
  return { ordenes, garantias }
}

const entregada = {
  ...ordenBase,
  estado: "ENTREGADO",
  users: null,
}

describe("POST /api/ordenes/[id]/entregar — entregas concurrentes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { success: true }, error: null } as any)
  })

  it("el UPDATE se condiciona al estado leído", async () => {
    mockAuthSuccess()
    const { ordenes } = mockEntrega({ data: entregada, error: null })

    const res = await POST(createPostRequest({}), createParams("o1"))

    expect(res.status).toBe(200)
    expect(ordenes.update).toHaveBeenCalled()
    expect(ordenes.eq).toHaveBeenCalledWith("estado", "REPARADO")
  })

  it("si otra entrega ganó la carrera (0 filas) responde 409 sin cargar deuda, garantía ni stock", async () => {
    mockAuthSuccess()
    const { garantias } = mockEntrega({
      data: null,
      error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" },
    })

    const res = await POST(createPostRequest({ diasGarantia: 30 }), createParams("o1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(409)
    expect(body.error).toMatch(/ya fue entregada|cambió/i)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalledWith("cargar_deuda_cuenta_corriente", expect.anything())
    expect(supabaseAdmin.rpc).not.toHaveBeenCalledWith("consumir_reservas_orden", expect.anything())
    expect(garantias.insert).not.toHaveBeenCalled()
  })

  it("si la base rechaza un segundo cargo de la orden (23505) la entrega no falla", async () => {
    mockAuthSuccess()
    mockEntrega({ data: entregada, error: null })
    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "cargar_deuda_cuenta_corriente") {
        return Promise.resolve({
          data: null,
          error: { code: "23505", message: "duplicate key value violates unique constraint" },
        })
      }
      return Promise.resolve({ data: { success: true }, error: null })
    }) as any)

    const res = await POST(createPostRequest({}), createParams("o1"))

    expect(res.status).toBe(200)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "cargar_deuda_cuenta_corriente",
      expect.objectContaining({ p_referencia_id: "o1", p_monto: 70 })
    )
  })
})

describe("POST /api/ordenes/[id]/entregar — total por debajo de lo cobrado", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { success: true }, error: null } as any)
  })

  it("un TECNICO no puede confirmar un total menor a lo ya cobrado", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: "tec-1" })
    const { ordenes } = mockEntrega({ data: entregada, error: null })

    const res = await POST(
      createPostRequest({ totalACobrar: 10, incluyeRepuestos: true }),
      createParams("o1")
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toContain("cobrado")
    expect(ordenes.update).not.toHaveBeenCalled()
  })

  it("tampoco un ADMIN: bajar el total por debajo de lo cobrado deja el saldo en negativo", async () => {
    mockAuthSuccess()
    const { ordenes } = mockEntrega({ data: entregada, error: null })

    const res = await POST(
      createPostRequest({ totalACobrar: 10, incluyeRepuestos: true }),
      createParams("o1")
    )

    expect(res.status).toBe(400)
    expect(ordenes.update).not.toHaveBeenCalled()
  })

  it("un total igual a lo cobrado sí se acepta", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: "tec-1" })
    mockEntrega({ data: { ...entregada, costo_final: "30" }, error: null })

    const res = await POST(
      createPostRequest({ totalACobrar: 30, incluyeRepuestos: true }),
      createParams("o1")
    )

    expect(res.status).toBe(200)
  })
})
