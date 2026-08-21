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

/**
 * Orden en REPARADO lista para entregar. El update devuelve la fila ya
 * entregada para que la ruta siga hasta el final.
 */
function mockOrdenEntregable() {
  const orden = {
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
  mockSupabaseFrom({
    ordenes_servicio: createChainMock({ ...orden, estado: "ENTREGADO", users: null }),
    organizations: createChainMock({ nombre: "Taller", zona_horaria: "America/Argentina/Buenos_Aires" }),
    garantias: createChainMock(null),
    orden_eventos: createChainMock(null),
  })
  // El primer .single() de la ruta trae la orden ORIGINAL (en REPARADO); los
  // siguientes traen la actualizada. createChainMock devuelve siempre lo mismo,
  // asi que se sobreescribe el primer llamado.
  const chain = supabaseAdmin.from("ordenes_servicio") as any
  chain.single
    .mockResolvedValueOnce({ data: orden, error: null })
}

describe("POST /api/ordenes/[id]/entregar — el fallo del consumo de reservas no puede ser invisible", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { success: true }, error: null } as any)
  })

  it("entrega sin warning cuando el consumo de reservas anda", async () => {
    mockAuthSuccess()
    mockOrdenEntregable()

    const res = await POST(createPostRequest({}), createParams("o1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.warning).toBeUndefined()
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("consumir_reservas_orden", {
      p_orden_id: "o1",
      p_user_id: "user-1",
    })
  })

  it("devuelve warning cuando el RPC responde con error (supabase.rpc NO lanza)", async () => {
    mockAuthSuccess()
    mockOrdenEntregable()
    // Reproduce el bug real: descontar_stock_deposito en modo strict lanzaba
    // P0010 y supabase lo devolvia como `error`, sin throw. El try/catch solo
    // no lo veia y el stock quedaba reservado para siempre.
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: "P0010", message: "STOCK_INSUFICIENTE_DEPOSITO: disponible 0, solicitado 1" },
    } as any)

    const res = await POST(createPostRequest({}), createParams("o1"))
    const { status, body } = await parseResponse(res)

    // La entrega NO se cancela: el equipo ya se le dio al cliente.
    expect(status).toBe(200)
    expect(body.estado).toBe("ENTREGADO")
    expect(body.warning).toMatch(/no se pudo descontar el stock/i)
  })

  it("devuelve warning si el RPC responde algo inesperado", async () => {
    mockAuthSuccess()
    mockOrdenEntregable()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { success: false }, error: null } as any)

    const res = await POST(createPostRequest({}), createParams("o1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.warning).toMatch(/incompleto/i)
  })
})
