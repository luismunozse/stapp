// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { createChainMock, createGetRequest, createPostRequest, mockSupabaseFrom, parseResponse } from "./helpers"
import { montarSupabaseEnMemoria } from "../helpers/supabase-memoria"

// PostgREST answers at most max_rows (1000) rows per read, with no error. These tests run the
// superadmin aggregations against an in-memory PostgREST with that cap (`maxFilas`), so a route
// that counts or sums the rows of one read gives a short number here too.

vi.mock("@/lib/superadmin-auth", () => ({
  requireSuperadmin: vi.fn().mockResolvedValue({ error: null, email: "admin@stapp.com.ar" }),
}))
vi.mock("@/lib/superadmin-audit", () => ({
  createSuperadminAuditLogger: () => ({
    broadcast: vi.fn().mockResolvedValue(undefined),
    emailCampaign: vi.fn().mockResolvedValue(undefined),
  }),
}))
vi.mock("@/lib/superadmin-org", () => ({ getSuperadminOrgId: vi.fn().mockResolvedValue(null) }))

import { GET as getPayments } from "@/app/api/superadmin/payments/route"
import { GET as getDashboard } from "@/app/api/superadmin/stats/dashboard/route"
import { GET as getLegacyStats } from "@/app/api/superadmin/stats/route"
import { GET as getEngagement } from "@/app/api/superadmin/stats/engagement/route"
import { GET as getFeatureUsage } from "@/app/api/superadmin/stats/feature-usage/route"
import { GET as getNps } from "@/app/api/superadmin/stats/nps/route"
import { GET as getSoporteStats } from "@/app/api/superadmin/soporte/stats/route"
import { POST as postBroadcast } from "@/app/api/superadmin/broadcast/route"
import { GET as getCampaigns, POST as postCampaign } from "@/app/api/superadmin/email-campaigns/route"

const MAX_ROWS = 1000
const pad = (i: number) => String(i).padStart(5, "0")
const rpcCalls = (mem: ReturnType<typeof montarSupabaseEnMemoria>, nombre: string) =>
  mem.escrituras.filter((e) => e.operacion === "rpc" && e.tabla === nombre).map((e) => e.carga as Record<string, unknown>)

beforeEach(() => vi.clearAllMocks())

// ─── payments ────────────────────────────────────────────────────────────────

describe("GET /api/superadmin/payments — totals by currency, in SQL", () => {
  const PAGO = {
    id: "p1", subscription_id: null, organization_id: "org-1", amount: 100, currency: "ARS",
    status: "SUCCEEDED", payment_provider: "MERCADOPAGO", provider_payment_id: "mp-1", invoice_url: null,
    receipt_url: null, paid_at: "2026-11-02T10:00:00Z", created_at: "2026-11-02T10:00:00Z",
    plan_name: "Premium", period_start: null, period_end: null,
  }

  const montar = (opciones: Parameters<typeof montarSupabaseEnMemoria>[1] = {}) =>
    montarSupabaseEnMemoria(
      { subscription_payments: [PAGO], webhook_events: [], organizations: [{ id: "org-1", nombre: "Taller", slug: "taller" }] },
      {
        resultadoRpc: (_n, args: any) =>
          args.p_desde && !args.p_provider
            ? [{ moneda: "USD", total: "20.00", cantidad: 1 }, { moneda: "ARS", total: "150000.50", cantidad: 1500 }]
            : [{ moneda: "USD", total: 70, cantidad: 3 }, { moneda: "ARS", total: 900000, cantidad: 4200 }],
        ...opciones,
      }
    )

  it("maps the RPC rows into per-currency totals, ARS first, and never adds ARS to USD", async () => {
    const mem = montar()
    const res = await parseResponse(await getPayments(createGetRequest("http://localhost/api/superadmin/payments?includeStats=true")))

    expect(res.status).toBe(200)
    expect(res.body.totalAmountByCurrency).toEqual([
      { moneda: "ARS", total: 900000, cantidad: 4200 },
      { moneda: "USD", total: 70, cantidad: 3 },
    ])
    expect(res.body.stats.mrrPorMoneda).toEqual([
      { moneda: "ARS", total: 150000.5, cantidad: 1500 },
      { moneda: "USD", total: 20, cantidad: 1 },
    ])
    expect(res.body.stats.totalHistoricoPorMoneda).toEqual(res.body.totalAmountByCurrency)
    // no mixed-currency number survives in the response
    expect(res.body).not.toHaveProperty("totalAmount")
    expect(res.body.stats).not.toHaveProperty("mrr")
    expect(res.body.stats).not.toHaveProperty("totalHistorico")
    // the sums come from SQL, not from reading payment rows
    expect(mem.consultas("subscription_payments").every((c) => !c.trim().startsWith("amount"))).toBe(true)
  })

  it("the filtered total gets the same filters as the list", async () => {
    const mem = montar()
    await getPayments(
      createGetRequest("http://localhost/api/superadmin/payments?status=pending&provider=mercadopago&dateFrom=2026-10-01&dateTo=2026-10-31")
    )
    expect(rpcCalls(mem, "superadmin_pagos_por_moneda")[0]).toEqual({
      p_status: "PENDING",
      p_provider: "MERCADOPAGO",
      p_desde: "2026-10-01",
      p_hasta: "2026-10-31T23:59:59.999Z",
      p_org_ids: null,
    })
  })

  it("an RPC error is a 500, not a total of $0", async () => {
    montar({ errorRpc: () => ({ message: "function superadmin_pagos_por_moneda does not exist" }) })
    const res = await parseResponse(await getPayments(createGetRequest("http://localhost/api/superadmin/payments?includeStats=true")))
    expect(res.status).toBe(500)
  })
})

// ─── dashboard ───────────────────────────────────────────────────────────────

describe("GET /api/superadmin/stats/dashboard — revenue by currency", () => {
  const mesActual = () => {
    const d = new Date()
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
  }

  const montarDashboard = () => {
    mockSupabaseFrom({
      organizations: createChainMock([], null, 7),
      users: createChainMock(null, null, 40),
      subscriptions: createChainMock(null, null, 5),
    })
  }

  it("monthly revenue and the 6-month chart keep each currency apart", async () => {
    montarDashboard()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: [
        { mes: mesActual(), moneda: "ARS", total: "250000.00" },
        { mes: mesActual(), moneda: "USD", total: "30.00" },
      ],
      error: null,
    } as any)

    const res = await parseResponse(await getDashboard())

    expect(res.status).toBe(200)
    expect(res.body.monthlyRevenueByCurrency).toEqual([
      { moneda: "ARS", total: 250000 },
      { moneda: "USD", total: 30 },
    ])
    expect(res.body.revenueCurrency).toBe("ARS")
    const ultimo = res.body.monthlyRevenue6m.at(-1)
    expect(ultimo.revenue).toBe(250000)
    expect(ultimo.porMoneda).toEqual({ ARS: 250000, USD: 30 })
    expect(res.body.monthlyRevenue6m).toHaveLength(6)
    expect(res.body).not.toHaveProperty("monthlyRevenue")
    expect(res.body.failedQueries).toBe(0)
  })

  it("counts come from count/head: the org growth chart and the plan split", async () => {
    montarDashboard()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: [], error: null } as any)
    const res = await parseResponse(await getDashboard())
    expect(res.body.orgGrowth6m.map((m: { count: number }) => m.count)).toEqual([7, 7, 7, 7, 7, 7])
    // 5 ACTIVE subs with a plan, 5 of them effectively premium (same mocked count)
    expect(res.body.planDistribution).toEqual({ premium: 5, free: 0 })
  })

  it("an RPC error is reported (failedQueries, revenue null), not shown as $0", async () => {
    montarDashboard()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: { message: "boom" } } as any)
    const res = await parseResponse(await getDashboard())
    expect(res.status).toBe(200)
    expect(res.body.monthlyRevenueByCurrency).toBeNull()
    expect(res.body.failedQueries).toBeGreaterThanOrEqual(1)
  })

  it("legacy /stats: revenue by currency and RPC error → 500", async () => {
    mockSupabaseFrom({
      organizations: createChainMock([], null, 3),
      users: createChainMock(null, null, 3),
      subscriptions: createChainMock(null, null, 1),
      subscription_payments: createChainMock([]),
    })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: [{ moneda: "ARS", total: 10, cantidad: 1 }], error: null } as any)
    const ok = await parseResponse(await getLegacyStats())
    expect(ok.body.monthlyRevenueByCurrency).toEqual([{ moneda: "ARS", total: 10, cantidad: 1 }])

    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: { message: "boom" } } as any)
    expect((await parseResponse(await getLegacyStats())).status).toBe(500)
  })
})

// ─── broadcast ───────────────────────────────────────────────────────────────

describe("POST /api/superadmin/broadcast — reaches every user past 1000", () => {
  const ORGS = [
    { id: "org-a", activo: true, slug: "a", deleted_at: null },
    { id: "org-b", activo: true, slug: "b", deleted_at: null },
    { id: "org-c", activo: true, slug: "c", deleted_at: null },
    { id: "org-off", activo: false, slug: "off", deleted_at: null },
    { id: "org-arch", activo: true, slug: "arch", deleted_at: "2026-01-01T00:00:00Z" },
    { id: "org-panel", activo: true, slug: "superadmin", deleted_at: null },
  ]
  const usuarios = () => {
    const filas: Array<{ id: string; organization_id: string; rol: string }> = []
    for (let i = 0; i < 2500; i++) {
      filas.push({ id: `u-${pad(i)}`, organization_id: ["org-a", "org-b", "org-c"][i % 3], rol: i % 5 === 0 ? "ADMIN" : "TECNICO" })
    }
    for (const org of ["org-off", "org-arch", "org-panel"]) {
      for (let i = 0; i < 20; i++) filas.push({ id: `x-${org}-${pad(i)}`, organization_id: org, rol: "ADMIN" })
    }
    return filas
  }
  const montar = () =>
    montarSupabaseEnMemoria(
      { organizations: ORGS, users: usuarios(), broadcasts: [], user_notifications: [] },
      { maxFilas: MAX_ROWS }
    )
  const enviar = (body: Record<string, unknown>) =>
    postBroadcast(createPostRequest({ title: "Novedad", message: "Hola", ...body }, "http://localhost/api/superadmin/broadcast"))

  it("target=all notifies all 2500 users of active orgs (3 pages), none of inactive/archived/panel orgs", async () => {
    const mem = montar()
    const res = await parseResponse(await enviar({ target: "all" }))

    expect(res.status).toBe(200)
    expect(res.body.totalUsers).toBe(2500)
    const notifs = mem.filas("user_notifications")
    expect(notifs).toHaveLength(2500)
    expect(new Set(notifs.map((n) => n.user_id)).size).toBe(2500)
    expect(notifs.some((n) => ["org-off", "org-arch", "org-panel"].includes(n.organization_id))).toBe(false)
    expect(mem.filas("broadcasts")[0].total_users).toBe(2500)
  })

  it("role filter still applies across pages", async () => {
    const mem = montar()
    const res = await parseResponse(await enviar({ target: "all", roles: ["ADMIN"] }))
    expect(res.body.totalUsers).toBe(500)
    expect(mem.filas("user_notifications").every((n) => n.user_id.startsWith("u-"))).toBe(true)
  })

  it("target=specific only reaches the chosen active orgs; with none chosen it is a 400, never everyone", async () => {
    const mem = montar()
    const res = await parseResponse(await enviar({ target: "specific", organizationIds: ["org-b", "org-off"] }))
    expect(res.body.totalUsers).toBe(833)
    expect(mem.filas("user_notifications").every((n) => n.organization_id === "org-b")).toBe(true)

    const mem2 = montar()
    const vacio = await parseResponse(await enviar({ target: "specific", organizationIds: [] }))
    expect(vacio.status).toBe(400)
    expect(mem2.filas("user_notifications")).toHaveLength(0)
  })

  it("a failed page is a 500 and nothing is sent", async () => {
    const mem = montarSupabaseEnMemoria(
      { organizations: ORGS, users: usuarios(), broadcasts: [], user_notifications: [] },
      { maxFilas: MAX_ROWS, errorDeLectura: { users: { message: "timeout" } } }
    )
    const res = await parseResponse(await enviar({ target: "all" }))
    expect(res.status).toBe(500)
    expect(mem.filas("user_notifications")).toHaveLength(0)
  })
})

// ─── email campaigns ─────────────────────────────────────────────────────────

describe("/api/superadmin/email-campaigns — audiences", () => {
  const ahora = Date.now()
  const SEGMENTOS = {
    trials: [
      { id: "t-vencido", nombre: "Vencido", slug: "v", trial_end: new Date(ahora - 86400000).toISOString() },
      { id: "t-2d", nombre: "Dos días", slug: "d", trial_end: new Date(ahora + 2 * 86400000).toISOString() },
    ],
    cancelados: [{ id: "c-1", nombre: "Cancelada", slug: "c" }],
    inactivas_7: [{ id: "i-1", nombre: "Dormida", slug: "i1" }, { id: "i-2", nombre: "Siesta", slug: "i2" }],
    inactivas_30: [{ id: "i-1", nombre: "Dormida", slug: "i1" }],
  }

  it("GET builds the segments from the SQL function, and never reads orders to guess inactivity", async () => {
    const mem = montarSupabaseEnMemoria({ lifecycle_emails: [] }, { resultadoRpc: () => SEGMENTOS })
    const res = await parseResponse(await getCampaigns())

    expect(res.status).toBe(200)
    const seg = Object.fromEntries(res.body.segments.map((s: any) => [s.id, s]))
    // the inactive segments are exactly what SQL returned (orgs without real orders in the window)
    expect(seg.inactive_30.orgs).toEqual([{ id: "i-1", nombre: "Dormida", slug: "i1", trialEnd: null }])
    expect(seg.inactive_30.count).toBe(1)
    expect(seg.inactive_7.count).toBe(2)
    expect(seg.trial_expired.orgs.map((o: any) => o.id)).toEqual(["t-vencido"])
    expect(seg.trial_expiring_3.orgs.map((o: any) => o.id)).toEqual(["t-2d"])
    expect(seg.all_trialing.count).toBe(1)
    expect(seg.canceled.orgs.map((o: any) => o.id)).toEqual(["c-1"])
    expect(mem.lecturas).not.toContain("ordenes_servicio")
    expect(mem.lecturas).not.toContain("organizations")
  })

  it("GET: an RPC error is a 500, not empty (or full) segments", async () => {
    montarSupabaseEnMemoria({ lifecycle_emails: [] }, { errorRpc: () => ({ message: "boom" }) })
    expect((await parseResponse(await getCampaigns())).status).toBe(500)
  })

  describe("POST", () => {
    const fetchOriginal = global.fetch
    beforeEach(() => {
      process.env.ENVIALOSIMPLE_API_KEY = "test-key"
      global.fetch = vi.fn().mockResolvedValue({ ok: true }) as any
    })
    afterEach(() => {
      global.fetch = fetchOriginal
      delete process.env.ENVIALOSIMPLE_API_KEY
    })

    it("mails every admin of 300 cuid orgs (1800 admins: chunked ids, each chunk paginated)", async () => {
      const orgs = Array.from({ length: 300 }, (_, i) => ({ id: `clx${pad(i)}abcdefghijklmn`, nombre: `Org ${i}`, slug: `org-${i}` }))
      const users = orgs.flatMap((o, i) => [
        ...Array.from({ length: 6 }, (_, k) => ({ id: `adm-${pad(i * 6 + k)}`, nombre: "Ana", email: `a${i}-${k}@t.com`, organization_id: o.id, rol: "ADMIN" })),
        { id: `tec-${pad(i)}`, nombre: "Tito", email: `t${i}@t.com`, organization_id: o.id, rol: "TECNICO" },
      ])
      const mem = montarSupabaseEnMemoria({ organizations: orgs, users, lifecycle_emails: [] }, { maxFilas: MAX_ROWS })

      const res = await parseResponse(
        await postCampaign(
          createPostRequest(
            { organizationIds: orgs.map((o) => o.id), subject: "Hola", htmlContent: "<p>{{nombre}} de {{organizacion}}</p>" },
            "http://localhost/api/superadmin/email-campaigns"
          ) as any
        )
      )

      expect(res.status).toBe(200)
      expect(res.body.total).toBe(1800)
      expect(res.body.sent).toBe(1800)
      expect(global.fetch).toHaveBeenCalledTimes(1800)
      expect(mem.filas("lifecycle_emails")).toHaveLength(1800)
      expect(new Set(mem.filas("lifecycle_emails").map((l) => l.user_id)).size).toBe(1800)
      const enviado = JSON.parse((vi.mocked(global.fetch).mock.calls[0][1] as RequestInit).body as string)
      expect(enviado.html).toMatch(/^<p>Ana de Org \d+<\/p>$/)
    })
  })
})

// ─── engagement ──────────────────────────────────────────────────────────────

describe("GET /api/superadmin/stats/engagement", () => {
  const METRICAS = {
    orgs: [
      {
        id: "org-1", nombre: "Activa", slug: "activa", created_at: "2025-01-01T00:00:00Z",
        sub_status: "ACTIVE", trial_end: null, plan_tipo: "PREMIUM",
        ordenes7d: 1500, ordenes_completadas7d: 3, ordenes30d: 4000, ventas7d: 2, ventas30d: 9,
        clientes_nuevos7d: 1, ultima_actividad: new Date().toISOString(),
      },
      {
        id: "org-2", nombre: "Dormida", slug: "dormida", created_at: "2025-01-01T00:00:00Z",
        sub_status: null, trial_end: null, plan_tipo: null,
        ordenes7d: 0, ordenes_completadas7d: 0, ordenes30d: 0, ventas7d: 0, ventas30d: 0,
        clientes_nuevos7d: 0, ultima_actividad: null,
      },
    ],
    tendencia_engagement: [],
    ultimo_calculo: null,
    tendencia_actividad: [{ fecha: "2026-11-10", total: 4009, orgs: 1 }],
    emails: { WELCOME: { sent: 1200, failed: 3 } },
  }

  it("maps the SQL counts into the same response shape", async () => {
    montarSupabaseEnMemoria(
      {
        subscriptions: [
          { id: "s-1", organization_id: "org-9", status: "CANCELED", canceled_at: new Date().toISOString(), trial_end: null, organizations: { nombre: "Se fue", slug: "sefue" } },
          { id: "s-2", organization_id: "org-8", status: "TRIALING", canceled_at: null, trial_end: "2020-01-01T00:00:00Z", organizations: null },
        ],
      },
      { resultadoRpc: () => METRICAS }
    )
    const res = await parseResponse(await getEngagement())

    expect(res.status).toBe(200)
    const porId = Object.fromEntries(res.body.organizations.map((o: any) => [o.id, o]))
    expect(porId["org-1"]).toMatchObject({ plan: "PREMIUM", subscriptionStatus: "ACTIVE", ordenes30d: 4000, ordenes7d: 1500, riesgo: "bajo" })
    expect(porId["org-2"]).toMatchObject({ plan: "FREE", subscriptionStatus: "NONE", avgEngagement7d: 0, riesgo: "alto" })
    expect(res.body.trend).toEqual([{ fecha: "2026-11-10", avgScore: 100, totalOrdenes: 4009, orgsActivas: 1 }])
    expect(res.body.emailStats).toEqual({ WELCOME: { sent: 1200, failed: 3 } })
    expect(res.body.churned).toEqual([{ organizationId: "org-9", nombre: "Se fue", canceledAt: expect.any(String) }])
    expect(res.body.trialsExpiredWithoutConversion).toBe(1)
    expect(res.body.summary.totalActive).toBe(2)
  })

  it("an RPC error is a 500, not an empty panel", async () => {
    montarSupabaseEnMemoria({ subscriptions: [] }, { errorRpc: () => ({ message: "boom" }) })
    expect((await parseResponse(await getEngagement())).status).toBe(500)
  })
})

// ─── feature usage ───────────────────────────────────────────────────────────

describe("GET /api/superadmin/stats/feature-usage", () => {
  const fila = (id: string, score: number) => ({
    organization_id: id, fecha: "2026-11-10", adoption_score: score, features_activas: 3, total_features: 13,
    usa_ordenes: true, ordenes_count: 5000, usa_ventas: score > 50, ventas_count: 2,
    clientes_count: 9, tecnicos_count: 2, vendedores_count: 1,
    organizations: { nombre: `Org ${id}`, slug: id },
  })

  it("uses the latest row per org from SQL", async () => {
    montarSupabaseEnMemoria({}, { resultadoRpc: () => [fila("a", 80), fila("b", 10)] })
    const res = await parseResponse(await getFeatureUsage())
    expect(res.status).toBe(200)
    expect(res.body.summary).toMatchObject({ totalOrgs: 2, avgAdoption: 45, lowAdoption: 1, highAdoption: 1, lastUpdate: "2026-11-10" })
    expect(res.body.organizations[0]).toMatchObject({ id: "b", nombre: "Org b", ordenes: 5000 })
    const ventas = res.body.featureAdoption.find((f: any) => f.feature === "usa_ventas")
    expect(ventas).toMatchObject({ usingCount: 1, totalOrgs: 2, percentage: 50 })
  })

  it("an RPC error is a 500", async () => {
    montarSupabaseEnMemoria({}, { errorRpc: () => ({ message: "boom" }) })
    expect((await parseResponse(await getFeatureUsage())).status).toBe(500)
  })
})

// ─── counts: NPS and support tickets ─────────────────────────────────────────

describe("NPS and support stats count past 1000 rows", () => {
  it("NPS counts every response", async () => {
    const recientes = new Date().toISOString()
    const respuestas = Array.from({ length: 1500 }, (_, i) => ({
      id: `n-${pad(i)}`,
      score: i < 900 ? 10 : i < 1200 ? 8 : 3,
      categoria: i < 900 ? "PROMOTOR" : i < 1200 ? "PASIVO" : "DETRACTOR",
      comentario: null,
      created_at: i < 1100 ? recientes : "2020-01-01T00:00:00Z",
      users: null,
      organizations: null,
    }))
    montarSupabaseEnMemoria({ nps_responses: respuestas }, { maxFilas: MAX_ROWS })
    const res = await parseResponse(await getNps())

    expect(res.status).toBe(200)
    expect(res.body.allTime).toEqual({ nps: 40, promotores: 900, pasivos: 300, detractores: 300, total: 1500 })
    expect(res.body.last30Days).toEqual({ nps: 82, promotores: 900, pasivos: 200, detractores: 0, total: 1100 })
  })

  it("support ticket counts are not capped at 1000", async () => {
    const estados = ["ABIERTO", "EN_PROCESO", "RESUELTO", "CERRADO"]
    const tickets = Array.from({ length: 2400 }, (_, i) => ({ id: `t-${pad(i)}`, estado: estados[i % 4] }))
    montarSupabaseEnMemoria({ support_tickets: tickets }, { maxFilas: MAX_ROWS })
    const res = await parseResponse(await getSoporteStats())
    expect(res.body).toEqual({ abiertos: 600, enProceso: 600, resueltos: 600, cerrados: 600, total: 2400 })
  })

  it("support stats: a failed count is a 500", async () => {
    montarSupabaseEnMemoria({ support_tickets: [] }, { errorDeLectura: { support_tickets: { message: "boom" } } })
    expect((await parseResponse(await getSoporteStats())).status).toBe(500)
  })
})
