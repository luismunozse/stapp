/**
 * Cancelar, renovar a mano o activar en masa desde el panel tiene que cortar el
 * débito automático del proveedor. Si solo se tocaba la fila:
 *  - cancelar: MercadoPago seguía cobrando y el webhook revivía la suscripción;
 *  - renovar/activar (pasa a MANUAL): cobro doble y período inflado por el webhook.
 * Si el proveedor falla, la fila no se toca (el reintento vuelve a pasar).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { montarSupabaseEnMemoria } from "../helpers/supabase-memoria"

const mp = vi.hoisted(() => ({ cancelPreApproval: vi.fn(), getPreApproval: vi.fn() }))

vi.mock("@/lib/superadmin-auth", () => ({
  requireSuperadmin: vi.fn().mockResolvedValue({ error: null, email: "root@stapp.com.ar" }),
}))
vi.mock("@/lib/superadmin-audit", () => ({
  createSuperadminAuditLogger: () => ({ log: vi.fn().mockResolvedValue(undefined) }),
}))
vi.mock("@/lib/mercadopago", () => mp)
vi.mock("@/lib/rebill", () => ({ cancelRebillSubscription: vi.fn(), getRebillSubscription: vi.fn() }))
vi.mock("@/lib/creem", () => ({ cancelCreemSubscription: vi.fn() }))

import { POST as cancel } from "@/app/api/superadmin/subscriptions/cancel/route"
import { POST as renew } from "@/app/api/superadmin/subscriptions/renew/route"
import { POST as bulk } from "@/app/api/superadmin/subscriptions/bulk/route"

const post = (body: unknown) =>
  new Request("http://localhost/api/superadmin/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

const FUTURO = "2099-01-01T00:00:00.000Z"
const PASADO = "2020-01-01T00:00:00.000Z"

const sub = (over: Record<string, unknown>) => ({
  id: "s1",
  organization_id: "o1",
  status: "ACTIVE",
  current_period_end: FUTURO,
  trial_end: null,
  cancel_at_period_end: false,
  canceled_at: null,
  payment_provider: "MERCADOPAGO",
  mercadopago_preapproval_id: "pre-1",
  rebill_subscription_id: null,
  creem_subscription_id: null,
  ...over,
})

const PLAN = { id: "p1", slug: "profesional", tipo: "PREMIUM", activo: true, precio_mensual: 100, precio_anual: 1000, moneda: "ARS", tier_order: 1 }

const updatesDe = (mem: ReturnType<typeof montarSupabaseEnMemoria>, tabla = "subscriptions") =>
  mem.escrituras.filter((e) => e.tabla === tabla && e.operacion === "update")

describe("superadmin: cancelación del débito automático", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mp.cancelPreApproval.mockResolvedValue({ status: "cancelled" })
    mp.getPreApproval.mockResolvedValue({ status: "authorized" })
  })

  describe("cancel", () => {
    it("cancela la preapproval y después la fila", async () => {
      const mem = montarSupabaseEnMemoria({ subscriptions: [sub({})] })
      const res = await cancel(post({ organizationId: "o1", immediate: true }))
      expect(res.status).toBe(200)
      expect(mp.cancelPreApproval).toHaveBeenCalledWith("pre-1")
      expect(mem.filas("subscriptions")[0].status).toBe("CANCELED")
    })

    it("también al cancelar al final del período", async () => {
      const mem = montarSupabaseEnMemoria({ subscriptions: [sub({})] })
      const res = await cancel(post({ organizationId: "o1", immediate: false }))
      expect(res.status).toBe(200)
      expect(mp.cancelPreApproval).toHaveBeenCalledWith("pre-1")
      expect(mem.filas("subscriptions")[0].cancel_at_period_end).toBe(true)
    })

    it("si MercadoPago falla: 502 y la fila queda igual", async () => {
      mp.cancelPreApproval.mockRejectedValue(new Error("timeout"))
      const mem = montarSupabaseEnMemoria({ subscriptions: [sub({})] })
      const res = await cancel(post({ organizationId: "o1", immediate: true }))
      expect(res.status).toBe(502)
      expect((await res.json()).providers).toEqual(["MERCADOPAGO"])
      expect(updatesDe(mem)).toEqual([])
      expect(mem.filas("subscriptions")[0].status).toBe("ACTIVE")
    })

    it("una preapproval que ya estaba cancelada cuenta como éxito", async () => {
      mp.cancelPreApproval.mockRejectedValue(new Error("boom"))
      mp.getPreApproval.mockResolvedValue({ status: "cancelled" })
      montarSupabaseEnMemoria({ subscriptions: [sub({})] })
      const res = await cancel(post({ organizationId: "o1", immediate: true }))
      expect(res.status).toBe(200)
    })

    it("sin proveedor no llama a MercadoPago", async () => {
      montarSupabaseEnMemoria({ subscriptions: [sub({ mercadopago_preapproval_id: null, payment_provider: "MANUAL" })] })
      const res = await cancel(post({ organizationId: "o1", immediate: true }))
      expect(res.status).toBe(200)
      expect(mp.cancelPreApproval).not.toHaveBeenCalled()
    })
  })

  describe("renew", () => {
    it("cancela la preapproval antes de pasar a MANUAL", async () => {
      const mem = montarSupabaseEnMemoria({ subscriptions: [sub({})], plans: [PLAN] })
      const res = await renew(post({ organizationId: "o1" }))
      expect(res.status).toBe(200)
      expect(mp.cancelPreApproval).toHaveBeenCalledWith("pre-1")
      expect(mem.filas("subscriptions")[0].payment_provider).toBe("MANUAL")
    })

    it("si MercadoPago falla: 502, sin renovar ni registrar pago", async () => {
      mp.cancelPreApproval.mockRejectedValue(new Error("timeout"))
      const mem = montarSupabaseEnMemoria({ subscriptions: [sub({})], plans: [PLAN] })
      const res = await renew(post({ organizationId: "o1" }))
      expect(res.status).toBe(502)
      expect(mem.escrituras.filter((e) => e.operacion !== "rpc")).toEqual([])
    })
  })

  describe("bulk", () => {
    it("activate omite las que tienen un período pago vigente y corta el débito de las demás", async () => {
      const mem = montarSupabaseEnMemoria({
        subscriptions: [
          sub({ id: "s1", organization_id: "o1", status: "ACTIVE", current_period_end: FUTURO, mercadopago_preapproval_id: "pre-1" }),
          sub({ id: "s2", organization_id: "o2", status: "PAST_DUE", current_period_end: PASADO, mercadopago_preapproval_id: "pre-2" }),
        ],
        plans: [PLAN],
      })
      const res = await bulk(post({ action: "activate", organizationIds: ["o1", "o2"] }))
      const body = await res.json()
      expect(body).toMatchObject({ successCount: 1, errorCount: 0, skippedCount: 1 })
      expect(mp.cancelPreApproval).toHaveBeenCalledTimes(1)
      expect(mp.cancelPreApproval).toHaveBeenCalledWith("pre-2")
      const [s1, s2] = mem.filas("subscriptions")
      expect(s1.current_period_end).toBe(FUTURO)
      expect(s1.payment_provider).toBe("MERCADOPAGO")
      expect(s2.status).toBe("ACTIVE")
      expect(s2.payment_provider).toBe("MANUAL")
    })

    it("cancel: si el proveedor falla en una org, esa queda igual y cuenta como error", async () => {
      mp.cancelPreApproval.mockImplementation(async (id: string) => {
        if (id === "pre-1") throw new Error("timeout")
        return { status: "cancelled" }
      })
      const mem = montarSupabaseEnMemoria({
        subscriptions: [
          sub({ id: "s1", organization_id: "o1", mercadopago_preapproval_id: "pre-1" }),
          sub({ id: "s2", organization_id: "o2", mercadopago_preapproval_id: "pre-2" }),
        ],
      })
      const res = await bulk(post({ action: "cancel", organizationIds: ["o1", "o2"], immediate: true }))
      expect(await res.json()).toMatchObject({ successCount: 1, errorCount: 1 })
      const [s1, s2] = mem.filas("subscriptions")
      expect(s1.status).toBe("ACTIVE")
      expect(s2.status).toBe("CANCELED")
    })
  })
})
