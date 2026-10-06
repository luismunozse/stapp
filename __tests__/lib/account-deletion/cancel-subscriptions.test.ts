// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createChainMock, mockSupabaseFrom } from "../../api/helpers"

vi.mock("@/lib/mercadopago", () => ({ cancelPreApproval: vi.fn(), getPreApproval: vi.fn() }))
vi.mock("@/lib/rebill", () => ({ cancelRebillSubscription: vi.fn(), getRebillSubscription: vi.fn() }))
vi.mock("@/lib/creem", () => ({ cancelCreemSubscription: vi.fn() }))

import { cancelPreApproval, getPreApproval } from "@/lib/mercadopago"
import { cancelRebillSubscription, getRebillSubscription } from "@/lib/rebill"
import { cancelCreemSubscription } from "@/lib/creem"
import { cancelOrganizationSubscriptions, isAlreadyCanceledError } from "@/lib/account-deletion/cancel-subscriptions"

const sub = (over: Record<string, unknown> = {}) => ({
  id: "s1", canceled_at: null,
  mercadopago_preapproval_id: null, rebill_subscription_id: null, creem_subscription_id: null,
  ...over,
})

describe("cancelOrganizationSubscriptions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("sin fila de suscripción no hay nada que cancelar", async () => {
    mockSupabaseFrom({ subscriptions: createChainMock(null, null) })
    expect(await cancelOrganizationSubscriptions("o1")).toEqual({ ok: true, canceled: [], skipped: true })
  })

  it("con canceled_at seteado igual llama a los proveedores con id (el webhook de Rebill no lo limpia al reactivar)", async () => {
    mockSupabaseFrom({ subscriptions: createChainMock(sub({ canceled_at: "2026-10-01", mercadopago_preapproval_id: "pre1", rebill_subscription_id: "rb1" })) })
    const r = await cancelOrganizationSubscriptions("o1")
    expect(r).toEqual({ ok: true, canceled: ["MERCADOPAGO", "REBILL"], skipped: false })
    expect(cancelPreApproval).toHaveBeenCalledWith("pre1")
    expect(cancelRebillSubscription).toHaveBeenCalledWith("rb1")
  })

  it("con canceled_at y sin ids de proveedor no hay nada que cancelar", async () => {
    mockSupabaseFrom({ subscriptions: createChainMock(sub({ canceled_at: "2026-10-01" })) })
    expect(await cancelOrganizationSubscriptions("o1")).toEqual({ ok: true, canceled: [], skipped: false })
    expect(cancelPreApproval).not.toHaveBeenCalled()
  })

  it("cancela en cada proveedor con id", async () => {
    mockSupabaseFrom({ subscriptions: createChainMock(sub({ mercadopago_preapproval_id: "pre1", rebill_subscription_id: "rb1" })) })
    const r = await cancelOrganizationSubscriptions("o1")
    expect(r).toEqual({ ok: true, canceled: ["MERCADOPAGO", "REBILL"], skipped: false })
    expect(cancelPreApproval).toHaveBeenCalledWith("pre1")
    expect(cancelRebillSubscription).toHaveBeenCalledWith("rb1")
    expect(cancelCreemSubscription).not.toHaveBeenCalled()
  })

  it("si uno falla intenta igual los demás y devuelve cuáles fallaron", async () => {
    mockSupabaseFrom({ subscriptions: createChainMock(sub({ mercadopago_preapproval_id: "pre1", rebill_subscription_id: "rb1" })) })
    vi.mocked(cancelRebillSubscription).mockRejectedValueOnce(new Error("boom"))
    const r = await cancelOrganizationSubscriptions("o1")
    expect(r).toEqual({ ok: false, failed: ["REBILL"], canceled: ["MERCADOPAGO"] })
  })

  it("'ya cancelada' cuenta como éxito (reintento tras un fallo parcial)", async () => {
    mockSupabaseFrom({ subscriptions: createChainMock(sub({ mercadopago_preapproval_id: "pre1" })) })
    vi.mocked(cancelPreApproval).mockRejectedValueOnce(new Error("Cannot modify a cancelled preapproval"))
    const r = await cancelOrganizationSubscriptions("o1")
    expect(r).toEqual({ ok: true, canceled: ["MERCADOPAGO"], skipped: false })
  })

  it("rechazo con objeto plano (SDK de MercadoPago) 'ya cancelada' cuenta como éxito", async () => {
    mockSupabaseFrom({ subscriptions: createChainMock(sub({ mercadopago_preapproval_id: "pre1" })) })
    vi.mocked(cancelPreApproval).mockRejectedValueOnce({ message: "Cannot modify a cancelled preapproval", status: 400 })
    expect(await cancelOrganizationSubscriptions("o1")).toEqual({ ok: true, canceled: ["MERCADOPAGO"], skipped: false })
  })

  it("rechazo con objeto plano que no es 'ya cancelada' es un fallo", async () => {
    mockSupabaseFrom({ subscriptions: createChainMock(sub({ mercadopago_preapproval_id: "pre1" })) })
    vi.mocked(cancelPreApproval).mockRejectedValueOnce({ message: "internal error", status: 500 })
    expect(await cancelOrganizationSubscriptions("o1")).toEqual({ ok: false, failed: ["MERCADOPAGO"], canceled: [] })
  })

  describe("error no reconocido: se consulta el estado real en el proveedor", () => {
    it("MercadoPago: estado cancelled => exito", async () => {
      mockSupabaseFrom({ subscriptions: createChainMock(sub({ mercadopago_preapproval_id: "pre1" })) })
      vi.mocked(cancelPreApproval).mockRejectedValueOnce({ message: "algo raro", status: 400 })
      vi.mocked(getPreApproval).mockResolvedValueOnce({ status: "cancelled" } as never)
      expect(await cancelOrganizationSubscriptions("o1")).toEqual({ ok: true, canceled: ["MERCADOPAGO"], skipped: false })
      expect(getPreApproval).toHaveBeenCalledWith("pre1")
    })

    it("MercadoPago: estado authorized => fallo", async () => {
      mockSupabaseFrom({ subscriptions: createChainMock(sub({ mercadopago_preapproval_id: "pre1" })) })
      vi.mocked(cancelPreApproval).mockRejectedValueOnce({ message: "algo raro", status: 400 })
      vi.mocked(getPreApproval).mockResolvedValueOnce({ status: "authorized" } as never)
      expect(await cancelOrganizationSubscriptions("o1")).toEqual({ ok: false, failed: ["MERCADOPAGO"], canceled: [] })
    })

    it("MercadoPago: si la consulta de estado falla se conserva el fallo original", async () => {
      mockSupabaseFrom({ subscriptions: createChainMock(sub({ mercadopago_preapproval_id: "pre1" })) })
      vi.mocked(cancelPreApproval).mockRejectedValueOnce({ message: "algo raro", status: 400 })
      vi.mocked(getPreApproval).mockRejectedValueOnce(new Error("timeout"))
      expect(await cancelOrganizationSubscriptions("o1")).toEqual({ ok: false, failed: ["MERCADOPAGO"], canceled: [] })
    })

    it("Rebill: estado cancelled => exito", async () => {
      mockSupabaseFrom({ subscriptions: createChainMock(sub({ rebill_subscription_id: "rb1" })) })
      vi.mocked(cancelRebillSubscription).mockRejectedValueOnce(new Error("boom"))
      vi.mocked(getRebillSubscription).mockResolvedValueOnce({ status: "cancelled" })
      expect(await cancelOrganizationSubscriptions("o1")).toEqual({ ok: true, canceled: ["REBILL"], skipped: false })
      expect(getRebillSubscription).toHaveBeenCalledWith("rb1")
    })

    it("Rebill: grafia canceled => exito", async () => {
      mockSupabaseFrom({ subscriptions: createChainMock(sub({ rebill_subscription_id: "rb1" })) })
      vi.mocked(cancelRebillSubscription).mockRejectedValueOnce(new Error("boom"))
      vi.mocked(getRebillSubscription).mockResolvedValueOnce({ status: "canceled" })
      expect(await cancelOrganizationSubscriptions("o1")).toEqual({ ok: true, canceled: ["REBILL"], skipped: false })
    })

    it("Rebill: estado active => fallo", async () => {
      mockSupabaseFrom({ subscriptions: createChainMock(sub({ rebill_subscription_id: "rb1" })) })
      vi.mocked(cancelRebillSubscription).mockRejectedValueOnce(new Error("boom"))
      vi.mocked(getRebillSubscription).mockResolvedValueOnce({ status: "active" })
      expect(await cancelOrganizationSubscriptions("o1")).toEqual({ ok: false, failed: ["REBILL"], canceled: [] })
    })

    it("Rebill: si la consulta de estado falla se conserva el fallo original", async () => {
      mockSupabaseFrom({ subscriptions: createChainMock(sub({ rebill_subscription_id: "rb1" })) })
      vi.mocked(cancelRebillSubscription).mockRejectedValueOnce(new Error("boom"))
      vi.mocked(getRebillSubscription).mockRejectedValueOnce(new Error("timeout"))
      expect(await cancelOrganizationSubscriptions("o1")).toEqual({ ok: false, failed: ["REBILL"], canceled: [] })
    })

    it("un error reconocido como 'ya cancelada' no consulta al proveedor", async () => {
      mockSupabaseFrom({ subscriptions: createChainMock(sub({ mercadopago_preapproval_id: "pre1" })) })
      vi.mocked(cancelPreApproval).mockRejectedValueOnce(new Error("Cannot modify a cancelled preapproval"))
      await cancelOrganizationSubscriptions("o1")
      expect(getPreApproval).not.toHaveBeenCalled()
    })
  })

  it("un error de lectura de la BD es un fallo, no 'no hay suscripción'", async () => {
    mockSupabaseFrom({ subscriptions: createChainMock(null, { message: "down" }) })
    expect(await cancelOrganizationSubscriptions("o1")).toEqual({ ok: false, failed: ["DB"], canceled: [] })
  })
})

describe("isAlreadyCanceledError", () => {
  it.each([
    ["Cannot modify a cancelled preapproval", true],
    ["subscription already canceled", true],
    ["la suscripción ya está cancelada", true],
    ["timeout de red", false],
    ["401 unauthorized", false],
  ])("%s -> %s", (msg, esperado) => {
    expect(isAlreadyCanceledError(new Error(msg))).toBe(esperado)
  })
})
