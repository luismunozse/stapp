import { describe, it, expect, beforeEach, vi } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

// El PUT genérico de cotizaciones cambia el estado "pelado". ACEPTADA no se
// asigna por acá: aceptar exige la firma de /aprobar (o el portal público) y
// dispara la reserva de stock. El resto de los cambios sigue una tabla de
// transiciones explícita.

vi.mock("@/lib/orden-transicion", () => ({ transicionarOrden: vi.fn() }))
vi.mock("@/lib/audit", () => ({
  createAuditLogger: () => ({ create: vi.fn(), update: vi.fn(), delete: vi.fn() }),
}))
vi.mock("@/lib/cotizacion-aprobar-orden", () => ({
  aplicarAprobacionCotizacionAOrden: vi.fn(),
}))
vi.mock("@/lib/webhooks/dispatcher", () => ({ emitWebhookEvent: vi.fn() }))
vi.mock("@/lib/subscriptions", () => ({ hasPlanFeature: vi.fn(() => Promise.resolve(true)) }))

function cotizacion(overrides: Record<string, unknown> = {}) {
  return {
    id: "cot-1",
    estado: "ENVIADA",
    tipo: "ORDEN",
    origen: null,
    organization_id: "org-1",
    created_by: "user-1",
    orden_id: null,
    revision_de: null,
    iva_porcentaje: 0,
    descuento_global_tipo: "porcentaje",
    descuento_global_valor: 0,
    items_cotizacion: [{ id: "it-1" }],
    ...overrides,
  }
}

function mockCot(overrides: Record<string, unknown> = {}) {
  const chain = createChainMock(cotizacion(overrides))
  mockSupabaseFrom({ cotizaciones: chain })
  return chain
}

function req(body: unknown) {
  return new Request("http://localhost/api/cotizaciones/cot-1", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

const params = { params: Promise.resolve({ id: "cot-1" }) }

function rpcNames() {
  return vi.mocked(supabaseAdmin.rpc).mock.calls.map((c) => c[0])
}

describe("PUT /api/cotizaciones/[id] — transiciones de estado", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { ok: true }, error: null } as any)
  })

  for (const rol of ["ADMIN", "VENDEDOR", "TECNICO"]) {
    it(`un ${rol} no puede marcarla ACEPTADA por el PUT (requiere la firma de /aprobar)`, async () => {
      mockAuthSuccess({ role: rol })
      const chain = mockCot({ estado: "ENVIADA" })
      const { PUT } = await import("@/app/api/cotizaciones/[id]/route")

      const res = await PUT(req({ estado: "ACEPTADA" }), params)
      const { status, body } = await parseResponse(res)

      expect(status).toBe(400)
      expect(body.error).toMatch(/aprob/i)
      expect(chain.update).not.toHaveBeenCalled()
    })
  }

  it("una ACEPTADA no vuelve a ENVIADA ni a BORRADOR", async () => {
    mockAuthSuccess()
    const { PUT } = await import("@/app/api/cotizaciones/[id]/route")

    for (const destino of ["ENVIADA", "BORRADOR"]) {
      const chain = mockCot({ estado: "ACEPTADA" })
      const res = await PUT(req({ estado: destino }), params)
      expect(res.status).toBe(400)
      expect(chain.update).not.toHaveBeenCalled()
    }
  })

  it("permite ENVIADA -> RECHAZADA", async () => {
    mockAuthSuccess()
    const chain = mockCot({ estado: "ENVIADA" })
    const { PUT } = await import("@/app/api/cotizaciones/[id]/route")

    const res = await PUT(req({ estado: "RECHAZADA" }), params)

    expect(res.status).toBe(200)
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ estado: "RECHAZADA" }))
  })

  it("permite BORRADOR -> ENVIADA y reabrir una RECHAZADA interna como BORRADOR", async () => {
    mockAuthSuccess()
    const { PUT } = await import("@/app/api/cotizaciones/[id]/route")

    mockCot({ estado: "BORRADOR" })
    expect((await PUT(req({ estado: "ENVIADA" }), params)).status).toBe(200)

    mockCot({ estado: "RECHAZADA" })
    expect((await PUT(req({ estado: "BORRADOR" }), params)).status).toBe(200)
  })

  it("reenviar el mismo estado es un no-op permitido", async () => {
    mockAuthSuccess()
    mockCot({ estado: "ENVIADA" })
    const { PUT } = await import("@/app/api/cotizaciones/[id]/route")

    expect((await PUT(req({ estado: "ENVIADA" }), params)).status).toBe(200)
  })

  it("el UPDATE de estado se condiciona al estado leído y responde 409 si cambió en el medio", async () => {
    mockAuthSuccess()
    const chain = mockCot({ estado: "ACEPTADA" })
    // El UPDATE ... RETURNING no encontró la fila en ACEPTADA: otro pedido la movió.
    chain.select = vi.fn().mockImplementation((cols?: string) => {
      if (cols === "id") {
        return Promise.resolve({ data: [], error: null })
      }
      return chain
    }) as any
    const { PUT } = await import("@/app/api/cotizaciones/[id]/route")

    const res = await PUT(req({ estado: "RECHAZADA" }), params)

    expect(res.status).toBe(409)
    expect(chain.eq).toHaveBeenCalledWith("estado", "ACEPTADA")
    expect(rpcNames()).not.toContain("liberar_items_cotizacion")
  })
})

describe("PUT /api/cotizaciones/[id] — liberación al rechazar una ACEPTADA", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { ok: true }, error: null } as any)
  })

  it("un PRESUPUESTO aceptado nunca reservó stock: rechazarlo no libera nada", async () => {
    mockAuthSuccess()
    mockCot({ estado: "ACEPTADA", tipo: "PRESUPUESTO" })
    const { PUT } = await import("@/app/api/cotizaciones/[id]/route")

    const res = await PUT(req({ estado: "RECHAZADA" }), params)

    expect(res.status).toBe(200)
    expect(rpcNames()).not.toContain("liberar_items_cotizacion")
  })

  it("una cotización tipo ORDEN aceptada sí libera su reserva", async () => {
    mockAuthSuccess()
    mockCot({ estado: "ACEPTADA", tipo: "ORDEN" })
    const { PUT } = await import("@/app/api/cotizaciones/[id]/route")

    const res = await PUT(req({ estado: "RECHAZADA" }), params)

    expect(res.status).toBe(200)
    expect(rpcNames()).toContain("liberar_items_cotizacion")
  })
})
