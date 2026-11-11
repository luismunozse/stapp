/**
 * La renovación manual desde el panel es idempotente por clave: el cliente manda
 * `idempotencyKey` (una por apertura del diálogo) y un doble clic o un reintento
 * tras un timeout devuelven la renovación ya hecha, sin un segundo pago ni un
 * segundo período. El pago se inserta ANTES de extender y el UNIQUE
 * (payment_provider, provider_payment_id) de la migración 305 deja pasar uno.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { montarSupabaseEnMemoria } from "../helpers/supabase-memoria"
import { supabaseAdmin } from "@/lib/supabase"

const mp = vi.hoisted(() => ({ cancelPreApproval: vi.fn(), getPreApproval: vi.fn() }))

vi.mock("@/lib/superadmin-auth", () => ({
  requireSuperadmin: vi.fn().mockResolvedValue({ error: null, email: "admin@stapp.com.ar" }),
}))
vi.mock("@/lib/mercadopago", () => mp)

import { POST as renew } from "@/app/api/superadmin/subscriptions/renew/route"

const post = (body: unknown) =>
  new Request("http://localhost/api/superadmin/subscriptions/renew", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

const FUTURO = "2099-01-01T00:00:00.000Z"
const CLAVE = "3f0c9a52-6d1e-4b7a-9c2f-1a2b3c4d5e6f"
const OTRA_CLAVE = "7e1d2c3b-4a5f-4e6d-8c7b-9a8f7e6d5c4b"

/** current_period_end tras sumar `meses` como lo hace la ruta (en hora local). */
const masMeses = (iso: string, meses: number) => {
  const d = new Date(iso)
  d.setMonth(d.getMonth() + meses)
  return d.toISOString()
}

const PLAN = { id: "p1", slug: "profesional", tipo: "PREMIUM", activo: true, precio_mensual: 100, precio_anual: 1000, moneda: "ARS", tier_order: 1 }

const SUB = {
  id: "s1",
  organization_id: "o1",
  status: "ACTIVE",
  current_period_end: FUTURO,
  payment_provider: "MANUAL",
  mercadopago_preapproval_id: null,
}

/**
 * Un pago y una suscripción de OTRA organización: la tabla en memoria deduce sus
 * columnas de las filas iniciales, y además prueban que nada se cruza entre orgs.
 */
const PAGO_AJENO = {
  id: "pay-ajeno",
  subscription_id: "s-ajena",
  organization_id: "o-ajena",
  amount: 100,
  currency: "ARS",
  payment_provider: "MANUAL",
  provider_payment_id: "manual-renew-clave-de-otra-org",
  status: "SUCCEEDED",
  paid_at: FUTURO,
  period_start: FUTURO,
  period_end: FUTURO,
}
const SUB_AJENA = { ...SUB, id: "s-ajena", organization_id: "o-ajena", plan_id: "p1", billing_period: "MONTHLY", current_period_start: FUTURO, cancel_at_period_end: false, canceled_at: null, trial_end: null }

const UNICOS = { subscription_payments: [["payment_provider", "provider_payment_id"]], subscriptions: [["organization_id"]] }

const montar = (tablas: Record<string, Record<string, unknown>[]> = {}) =>
  montarSupabaseEnMemoria(
    { subscriptions: [SUB, SUB_AJENA], plans: [PLAN], subscription_payments: [PAGO_AJENO], ...tablas },
    { unicos: UNICOS }
  )

/** Los pagos de o1 (sin el ajeno). */
const pagosDe = (mem: ReturnType<typeof montar>, org = "o1") =>
  mem.filas("subscription_payments").filter((p) => p.organization_id === org)

const insertsEn = (mem: ReturnType<typeof montar>, tabla: string) =>
  mem.escrituras.filter((e) => e.tabla === tabla && e.operacion === "insert")

describe("POST /api/superadmin/subscriptions/renew — idempotencia", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mp.cancelPreApproval.mockResolvedValue({ status: "cancelled" })
  })

  it("misma clave dos veces: un solo pago, el período se extiende una vez y la segunda responde lo mismo", async () => {
    const mem = montar()

    const r1 = await renew(post({ organizationId: "o1", idempotencyKey: CLAVE }))
    const b1 = await r1.json()
    const r2 = await renew(post({ organizationId: "o1", idempotencyKey: CLAVE }))
    const b2 = await r2.json()

    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    expect(b1.periodEnd).toBe(masMeses(FUTURO, 1))
    expect(b2).toMatchObject({ success: true, periodEnd: b1.periodEnd, message: b1.message, replayed: true })

    expect(pagosDe(mem)).toHaveLength(1)
    expect(pagosDe(mem)[0]).toMatchObject({
      payment_provider: "MANUAL",
      provider_payment_id: `manual-renew-${CLAVE}`,
      period_start: FUTURO,
      period_end: masMeses(FUTURO, 1),
    })
    expect(mem.filas("subscriptions").find((x) => x.id === "s1")!.current_period_end).toBe(masMeses(FUTURO, 1))
    // El reintento no vuelve a escribir nada: ni historial, ni auditoría, ni notificaciones.
    expect(insertsEn(mem, "subscription_history")).toHaveLength(1)
    expect(insertsEn(mem, "audit_logs")).toHaveLength(1)
  })

  it("misma clave en paralelo (doble clic): solo el que gana el INSERT extiende", async () => {
    const mem = montar()

    const [r1, r2] = await Promise.all([
      renew(post({ organizationId: "o1", idempotencyKey: CLAVE })),
      renew(post({ organizationId: "o1", idempotencyKey: CLAVE })),
    ])
    const [b1, b2] = [await r1.json(), await r2.json()]

    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    expect(b1.periodEnd).toBe(masMeses(FUTURO, 1))
    expect(b2.periodEnd).toBe(masMeses(FUTURO, 1))
    expect(pagosDe(mem)).toHaveLength(1)
    expect(mem.escrituras.filter((e) => e.tabla === "subscriptions" && e.operacion === "update")).toHaveLength(1)
    expect(mem.filas("subscriptions").find((x) => x.id === "s1")!.current_period_end).toBe(masMeses(FUTURO, 1))
  })

  it("claves distintas: son dos renovaciones y se apilan", async () => {
    const mem = montar()

    const r1 = await renew(post({ organizationId: "o1", idempotencyKey: CLAVE }))
    const r2 = await renew(post({ organizationId: "o1", idempotencyKey: OTRA_CLAVE }))

    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    expect((await r2.json()).replayed).toBeUndefined()
    expect(pagosDe(mem)).toHaveLength(2)
    expect(mem.filas("subscriptions").find((x) => x.id === "s1")!.current_period_end).toBe(masMeses(masMeses(FUTURO, 1), 1))
  })

  it("sin clave o con una clave inválida: 400 y no toca nada", async () => {
    const mem = montar()

    const sinClave = await renew(post({ organizationId: "o1" }))
    const invalida = await renew(post({ organizationId: "o1", idempotencyKey: "x; drop" }))

    expect(sinClave.status).toBe(400)
    expect(invalida.status).toBe(400)
    expect(mem.escrituras).toEqual([])
    expect(mp.cancelPreApproval).not.toHaveBeenCalled()
  })

  it("una clave ya usada para otra organización: 409 y no toca nada", async () => {
    const mem = montar({
      subscription_payments: [{ ...PAGO_AJENO, provider_payment_id: `manual-renew-${CLAVE}` }],
    })

    const res = await renew(post({ organizationId: "o1", idempotencyKey: CLAVE }))

    expect(res.status).toBe(409)
    expect(mem.escrituras).toEqual([])
    expect(mem.filas("subscriptions").find((x) => x.id === "s1")!.current_period_end).toBe(FUTURO)
  })

  it("si falla la extensión, se borra el pago reclamado y el reintento con la misma clave renueva", async () => {
    const mem = montar()
    const fromEnMemoria = vi.mocked(supabaseAdmin.from).getMockImplementation()!
    let fallarUpdate = true
    vi.mocked(supabaseAdmin.from).mockImplementation(((nombre: string) => {
      const tabla = fromEnMemoria(nombre) as any
      if (nombre !== "subscriptions" || !fallarUpdate) return tabla
      return {
        ...tabla,
        update: () => ({ eq: async () => ({ data: null, error: { code: "57014", message: "timeout" } }) }),
      }
    }) as any)

    const fallida = await renew(post({ organizationId: "o1", idempotencyKey: CLAVE }))
    expect(fallida.status).toBe(500)
    expect(pagosDe(mem)).toHaveLength(0)
    expect(mem.filas("subscriptions").find((x) => x.id === "s1")!.current_period_end).toBe(FUTURO)

    fallarUpdate = false
    const reintento = await renew(post({ organizationId: "o1", idempotencyKey: CLAVE }))
    const body = await reintento.json()
    expect(reintento.status).toBe(200)
    expect(body.replayed).toBeUndefined()
    expect(pagosDe(mem)).toHaveLength(1)
    expect(mem.filas("subscriptions").find((x) => x.id === "s1")!.current_period_end).toBe(masMeses(FUTURO, 1))
  })

  it("sin suscripción previa: la crea con su pago, y el reintento no crea otra", async () => {
    const mem = montar({ subscriptions: [SUB_AJENA] })

    const r1 = await renew(post({ organizationId: "o9", idempotencyKey: CLAVE }))
    const r2 = await renew(post({ organizationId: "o9", idempotencyKey: CLAVE }))

    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    expect((await r2.json()).replayed).toBe(true)
    expect(mem.filas("subscriptions").filter((x) => x.organization_id === "o9")).toHaveLength(1)
    expect(pagosDe(mem, "o9")).toHaveLength(1)
    expect(mp.cancelPreApproval).not.toHaveBeenCalled()
  })
})
