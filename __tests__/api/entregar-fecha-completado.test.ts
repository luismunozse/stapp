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
  tecnico_id: null,
  costo_final: "0",
  descuento_cobro: "0",
  total_cobrado: "0",
  fecha_completado: null,
}

/**
 * `original` son los valores de la orden ANTES de entregar (lo que devuelve
 * el primer fetch, el que la ruta usa para decidir el payload del UPDATE).
 * El segundo (y siguiente) `.single()` devuelve la misma orden ya en
 * ENTREGADO: a esta suite le importa el PAYLOAD que se manda a `.update()`,
 * no lo que Supabase devuelve de vuelta.
 */
function mockEntrega(original: Record<string, unknown>) {
  const ordenOriginal = { ...ordenBase, ...original }
  const ordenes = createChainMock({ ...ordenOriginal, estado: "ENTREGADO", users: null })
  mockSupabaseFrom({
    ordenes_servicio: ordenes,
    repuestos_orden: createChainMock([]),
    organizations: createChainMock({ nombre: "Taller", zona_horaria: "America/Argentina/Buenos_Aires" }),
    garantias: createChainMock(null),
    orden_eventos: createChainMock(null),
  })
  ;(ordenes as any).single.mockResolvedValueOnce({ data: ordenOriginal, error: null })
  return ordenes
}

describe("POST /api/ordenes/[id]/entregar — fecha_completado (devengo contable)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { success: true }, error: null } as any)
  })

  // Cubre el bug: SIN_FALLA_DETECTADA -> ENTREGADO salta REPARADO, que es el
  // ÚNICO lugar (app/api/ordenes/[id]/route.ts:384-387) donde se escribía
  // fecha_completado. Si se revierte el spread condicional agregado en el
  // .update() de este endpoint (app/api/ordenes/[id]/entregar/route.ts,
  // dentro del bloque ~131), este test falla: el payload capturado no
  // tendría la clave fecha_completado y la orden accrue en $0 para siempre.
  it("setea fecha_completado al entregar una orden que nunca pasó por REPARADO (NULL)", async () => {
    mockAuthSuccess()
    const ordenes = mockEntrega({ fecha_completado: null })

    const before = new Date().toISOString()
    const res = await POST(createPostRequest({}), createParams("o1"))
    const after = new Date().toISOString()

    const { status } = await parseResponse(res)
    expect(status).toBe(200)

    const payload = ordenes.update.mock.calls[0][0]
    expect(payload.fecha_completado).toBeDefined()
    expect(typeof payload.fecha_completado).toBe("string")
    // Es el timestamp del momento de la entrega, no un valor heredado/fijo.
    expect(payload.fecha_completado >= before && payload.fecha_completado <= after).toBe(true)
  })

  // Cubre el caso inverso: una orden reparada en agosto y entregada en
  // septiembre (reingreso, o backdoor SIN_FALLA_DETECTADA con REPARADO
  // previo) debe seguir devengando en agosto. Si el guard
  // `!orden.fecha_completado` se revierte a una escritura incondicional,
  // este test falla: el payload traería un fecha_completado NUEVO pisando
  // el valor original de agosto.
  it("NO pisa fecha_completado si la orden ya lo tenía (preserva el devengo original)", async () => {
    mockAuthSuccess()
    const fechaOriginalDevengo = "2026-08-15T10:00:00.000Z"
    const ordenes = mockEntrega({ fecha_completado: fechaOriginalDevengo })

    const res = await POST(createPostRequest({}), createParams("o1"))
    const { status } = await parseResponse(res)
    expect(status).toBe(200)

    const payload = ordenes.update.mock.calls[0][0]
    expect(payload).not.toHaveProperty("fecha_completado")
  })
})
