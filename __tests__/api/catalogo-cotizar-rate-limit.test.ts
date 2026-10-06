import { describe, it, expect, beforeEach, vi } from "vitest"
import { mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/subscriptions", () => ({ hasPlanFeature: vi.fn().mockResolvedValue(true) }))
vi.mock("@/lib/counters", () => ({ getNextQuoteNumber: vi.fn().mockResolvedValue("COT-42") }))
vi.mock("@/lib/rate-limit-db", () => ({ rateLimitDb: vi.fn() }))

import { getNextQuoteNumber } from "@/lib/counters"
import { rateLimitDb } from "@/lib/rate-limit-db"
import { POST } from "@/app/api/public/catalogo/[slug]/cotizar/route"

const BODY = {
  cliente: { nombre: "Ana", telefono: "1122334455" },
  consent: true,
  items: [{ itemId: "i1", cantidad: 1 }],
}

function call(headers: Record<string, string> = { "x-forwarded-for": "1.2.3.4, 9.9.9.9" }) {
  const req = new Request("http://localhost:3000/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(BODY),
  })
  return POST(req, { params: Promise.resolve({ slug: "mi-taller" }) })
}

let cotizacionesChain: ReturnType<typeof createChainMock>

function mockTables(openOrders: number) {
  cotizacionesChain = createChainMock(null, null, openOrders)
  mockSupabaseFrom({
    catalogo_config: createChainMock({ organization_id: "org-1", activo: true, whatsapp: null, titulo: "X" }),
    catalogo_items: createChainMock([
      { id: "i1", nombre: "Funda", precio: 100, stock: null, inventario_id: null, activo: true, inventario: null, variantes: [] },
    ]),
    clientes: createChainMock({ id: "cli-1", nombre: "Ana", email: null }),
    cotizaciones: cotizacionesChain,
    users: createChainMock([]),
  })
}

describe("POST /api/public/catalogo/[slug]/cotizar — rate limit", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(rateLimitDb).mockResolvedValue(true)
    vi.mocked(getNextQuoteNumber).mockResolvedValue("COT-42")
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { ok: true, cotizacion_id: "cot-1", total: 100 },
      error: null,
    } as never)
    mockTables(0)
  })

  it("429 with Retry-After when the IP bucket is exhausted, before any write", async () => {
    vi.mocked(rateLimitDb).mockResolvedValue(false)
    const res = await call()
    const { status, body } = await parseResponse(res)
    expect(status).toBe(429)
    expect(body.code).toBe("RATE_LIMITED")
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0)
    expect(getNextQuoteNumber).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("keys the bucket by slug and the first x-forwarded-for hop", async () => {
    await call()
    const keys = vi.mocked(rateLimitDb).mock.calls.map((c) => c[0])
    expect(keys.every((k) => k.includes("mi-taller") && k.includes("1.2.3.4"))).toBe(true)
    expect(keys.length).toBe(2) // short window + daily window
  })

  it("falls back to x-real-ip and then to 'unknown'", async () => {
    await call({ "x-real-ip": "7.7.7.7" })
    expect(vi.mocked(rateLimitDb).mock.calls[0][0]).toContain("7.7.7.7")
    vi.mocked(rateLimitDb).mockClear()
    await call({})
    expect(vi.mocked(rateLimitDb).mock.calls[0][0]).toContain("unknown")
  })

  it("429 when the phone already has 3 open catalog orders; no number is taken", async () => {
    mockTables(3)
    const res = await call()
    const { status, body } = await parseResponse(res)
    expect(status).toBe(429)
    expect(body.code).toBe("OPEN_ORDERS_LIMIT")
    expect(body.error).toMatch(/pendientes/i)
    expect(getNextQuoteNumber).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("happy path: takes the number only after validation and creates the quote", async () => {
    mockTables(2)
    const res = await call()
    expect(res.status).toBe(201)
    expect(getNextQuoteNumber).toHaveBeenCalledTimes(1)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("crear_cotizacion_publica_atomica", expect.anything())
  })

  it("does not burn a number when the request fails validation (stock)", async () => {
    mockSupabaseFrom({
      catalogo_config: createChainMock({ organization_id: "org-1", activo: true, whatsapp: null, titulo: "X" }),
      catalogo_items: createChainMock([
        { id: "i1", nombre: "Funda", precio: 100, stock: 0, inventario_id: "inv-1", activo: true,
          inventario: { id: "inv-1", stock: 0, stock_reservado: 0, deleted_at: null, nombre: "Funda" }, variantes: [] },
      ]),
    })
    const res = await call()
    expect(res.status).toBe(409)
    expect(getNextQuoteNumber).not.toHaveBeenCalled()
  })

  it("a stock 409 does not consume any IP quota (retries after a rejection are free)", async () => {
    mockSupabaseFrom({
      catalogo_config: createChainMock({ organization_id: "org-1", activo: true, whatsapp: null, titulo: "X" }),
      catalogo_items: createChainMock([
        { id: "i1", nombre: "Funda", precio: 100, stock: 0, inventario_id: "inv-1", activo: true,
          inventario: { id: "inv-1", stock: 0, stock_reservado: 0, deleted_at: null, nombre: "Funda" }, variantes: [] },
      ]),
    })
    const res = await call()
    expect(res.status).toBe(409)
    expect(rateLimitDb).not.toHaveBeenCalled()
  })

  it("an invalid body (400) does not consume quota", async () => {
    const req = new Request("http://localhost:3000/api/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ consent: true }),
    })
    const res = await POST(req, { params: Promise.resolve({ slug: "mi-taller" }) })
    expect(res.status).toBe(400)
    expect(rateLimitDb).not.toHaveBeenCalled()
  })

  it("short window blocked: message + Retry-After of 10 min, and the daily counter is NOT touched", async () => {
    vi.mocked(rateLimitDb).mockResolvedValueOnce(false)
    const res = await call()
    const { status, body } = await parseResponse(res)
    expect(status).toBe(429)
    expect(res.headers.get("Retry-After")).toBe("600")
    expect(body.error).toMatch(/unos minutos/i)
    expect(rateLimitDb).toHaveBeenCalledTimes(1)
    expect(vi.mocked(rateLimitDb).mock.calls[0][0]).toContain("short")
  })

  it("daily window blocked: own message and Retry-After of 24h", async () => {
    vi.mocked(rateLimitDb).mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const res = await call()
    const { status, body } = await parseResponse(res)
    expect(status).toBe(429)
    expect(res.headers.get("Retry-After")).toBe("86400")
    expect(body.error).toMatch(/por hoy/i)
    expect(body.error).toMatch(/WhatsApp/)
    expect(body.code).toBe("RATE_LIMITED")
  })

  it("open orders only count the last 48 hours", async () => {
    mockTables(0)
    await call()
    const [col, iso] = cotizacionesChain.gte.mock.calls[0]
    expect(col).toBe("created_at")
    const horas = (Date.now() - new Date(iso as string).getTime()) / 3_600_000
    expect(horas).toBeGreaterThan(47.9)
    expect(horas).toBeLessThan(48.1)
  })
})
