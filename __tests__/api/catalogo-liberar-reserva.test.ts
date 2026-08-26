import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  mockAuthSuccess,
  mockSupabaseFrom,
  createChainMock,
  createPostRequest,
  parseResponse,
} from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

// La reserva del catálogo la toma un visitante anónimo. Si no hay forma de
// devolverla, cambiar "descuento" por "reserva" no arregla nada: el stock
// queda inmovilizado para siempre y el comprador sigue viendo "Agotado".
//
// Los tres caminos por los que una solicitud del catálogo muere sin venta son
// rechazo, borrado y abandono. Los tres tienen que liberar.

vi.mock("@/lib/orden-transicion", () => ({ transicionarOrden: vi.fn() }))
vi.mock("@/lib/audit", () => ({
  createAuditLogger: () => ({ create: vi.fn(), update: vi.fn(), delete: vi.fn() }),
}))
vi.mock("@/lib/cotizacion-aprobar-orden", () => ({
  aplicarAprobacionCotizacionAOrden: vi.fn(),
}))
vi.mock("@/lib/webhooks/dispatcher", () => ({ emitWebhookEvent: vi.fn() }))
vi.mock("@/lib/subscriptions", () => ({ hasPlanFeature: vi.fn(() => Promise.resolve(true)) }))

function rpcNames() {
  return vi.mocked(supabaseAdmin.rpc).mock.calls.map((c) => c[0])
}

describe("liberación de la reserva del catálogo", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { ok: true }, error: null } as any)
  })

  it("releases when a catalog quote is rejected straight from ENVIADA", async () => {
    // El camino real: la cotización del catálogo nace ENVIADA con la reserva ya
    // tomada. El release viejo sólo corría en ACEPTADA → RECHAZADA, así que
    // rechazar desde ENVIADA no liberaba nada.
    const { PUT } = await import("@/app/api/cotizaciones/[id]/route")

    mockSupabaseFrom({
      cotizaciones: createChainMock({
        id: "cot-1",
        estado: "ENVIADA",
        tipo: "PRESUPUESTO",
        organization_id: "org-1",
        created_by: "user-1",
        orden_id: null,
        iva_porcentaje: 0,
        descuento_global_tipo: "porcentaje",
        descuento_global_valor: 0,
      }),
    })

    const req = new Request("http://localhost/api/cotizaciones/cot-1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado: "RECHAZADA" }),
    })

    await PUT(req, { params: Promise.resolve({ id: "cot-1" }) })

    expect(rpcNames()).toContain("liberar_reserva_catalogo")
  })

  it("releases when a catalog quote is soft-deleted", async () => {
    const { DELETE } = await import("@/app/api/cotizaciones/[id]/route")

    mockSupabaseFrom({
      cotizaciones: createChainMock({
        id: "cot-1",
        estado: "ENVIADA",
        organization_id: "org-1",
        orden_id: null,
      }),
    })

    const req = new Request("http://localhost/api/cotizaciones/cot-1", { method: "DELETE" })
    await DELETE(req, { params: Promise.resolve({ id: "cot-1" }) })

    expect(rpcNames()).toContain("liberar_reserva_catalogo")
  })

  it("releases when the buyer rejects from the public link", async () => {
    const { POST } = await import("@/app/api/public/cotizaciones/[token]/rechazar/route")

    mockSupabaseFrom({
      cotizaciones: createChainMock({
        id: "cot-1",
        estado: "ENVIADA",
        orden_id: null,
        organization_id: "org-1",
      }),
    })

    const req = createPostRequest({ motivo: "no me sirve" })
    await POST(req, { params: Promise.resolve({ token: "a".repeat(32) }) })

    expect(rpcNames()).toContain("liberar_reserva_catalogo")
  })
})

describe("GET /api/cron/catalogo-reservas-vencidas", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = "secreto"
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { cotizaciones: 2, items: 3 },
      error: null,
    } as any)
  })

  it("rejects a request without the cron secret", async () => {
    const { GET } = await import("@/app/api/cron/catalogo-reservas-vencidas/route")
    const res = await GET(new Request("http://localhost/api/cron/catalogo-reservas-vencidas"))
    expect(res.status).toBe(401)
  })

  it("expires stale catalog reservations when authorized", async () => {
    const { GET } = await import("@/app/api/cron/catalogo-reservas-vencidas/route")
    const res = await GET(
      new Request("http://localhost/api/cron/catalogo-reservas-vencidas", {
        headers: { authorization: "Bearer secreto" },
      })
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(rpcNames()).toContain("expirar_reservas_catalogo")
  })
})
