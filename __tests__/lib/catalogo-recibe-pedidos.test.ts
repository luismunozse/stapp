import { describe, it, expect, beforeEach, vi } from "vitest"
import { mockSupabaseFrom, createChainMock } from "../api/helpers"

vi.mock("@/lib/subscriptions", () => ({ hasPlanFeature: vi.fn() }))

import { hasPlanFeature } from "@/lib/subscriptions"
import { catalogoRecibePedidos } from "@/lib/catalogo/recibe-pedidos"

describe("catalogoRecibePedidos (falla abierto)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("true si el plan tiene la feature", async () => {
    mockSupabaseFrom({ subscriptions: createChainMock({ id: "s1" }) })
    vi.mocked(hasPlanFeature).mockResolvedValue(true)
    expect(await catalogoRecibePedidos("org-1")).toBe(true)
  })

  it("false solo con un 'no' confirmado: suscripción sin la feature", async () => {
    mockSupabaseFrom({ subscriptions: createChainMock({ id: "s1" }) })
    vi.mocked(hasPlanFeature).mockResolvedValue(false)
    expect(await catalogoRecibePedidos("org-1")).toBe(false)
  })

  it("false si la org no tiene suscripción (igual que /cotizar)", async () => {
    mockSupabaseFrom({ subscriptions: createChainMock(null) })
    vi.mocked(hasPlanFeature).mockResolvedValue(false)
    expect(await catalogoRecibePedidos("org-1")).toBe(false)
  })

  it("true si la consulta de suscripción devuelve error", async () => {
    mockSupabaseFrom({ subscriptions: createChainMock(null, { message: "timeout" }) })
    vi.mocked(hasPlanFeature).mockResolvedValue(false)
    expect(await catalogoRecibePedidos("org-1")).toBe(true)
  })

  it("true si hasPlanFeature lanza", async () => {
    mockSupabaseFrom({ subscriptions: createChainMock({ id: "s1" }) })
    vi.mocked(hasPlanFeature).mockRejectedValue(new Error("boom"))
    expect(await catalogoRecibePedidos("org-1")).toBe(true)
  })
})
