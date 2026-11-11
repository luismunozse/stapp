// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const updates: { tabla: string; datos: Record<string, unknown> }[] = []
let urlWebhook = "https://hooks.example.com/x"

function cadena(tabla: string) {
  const c: Record<string, unknown> = {}
  const self = () => c
  c.select = self
  c.eq = self
  c.update = (datos: Record<string, unknown>) => { updates.push({ tabla, datos }); return c }
  c.single = async () => ({
    data: {
      id: "d1", event: "webhook.test", payload: {}, attempts: 0, webhook_id: "w1",
      webhooks: { id: "w1", url: urlWebhook, secret: "s", headers: null, activo: true, deleted_at: null, consecutive_failures: 0 },
    },
    error: null,
  })
  c.maybeSingle = async () => ({ data: { consecutive_failures: 0 }, error: null })
  c.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(r)
  return c
}
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: (t: string) => cadena(t), rpc: async () => ({ data: null, error: null }) } }))

const lookupMock = vi.fn()
vi.mock("node:dns", () => ({ promises: { lookup: (...a: unknown[]) => lookupMock(...a) } }))

import { dispatch } from "@/lib/webhooks/dispatcher"

const fetchMock = vi.fn()

beforeEach(() => {
  updates.length = 0
  urlWebhook = "https://hooks.example.com/x"
  lookupMock.mockReset().mockResolvedValue([{ address: "93.184.216.34", family: 4 }])
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const entrega = () => updates.find((u) => u.tabla === "webhook_deliveries")?.datos

describe("dispatch: destinos internos", () => {
  it("no hace fetch si la URL apunta a una IP interna", async () => {
    urlWebhook = "https://127.0.0.1:9001/2018-06-01/runtime/invocation/next"
    const r = await dispatch("d1")
    expect(fetchMock).not.toHaveBeenCalled()
    expect(r.ok).toBe(false)
    expect(entrega()).toMatchObject({ status: "FAILED", http_status: null, response_body: expect.stringMatching(/red interna/) })
  })

  it("no hace fetch si el dominio resuelve a una IP interna", async () => {
    lookupMock.mockResolvedValue([{ address: "169.254.169.254", family: 4 }])
    await dispatch("d1")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("no sigue redirects", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }))
    await dispatch("d1")
    expect(fetchMock).toHaveBeenCalledWith(urlWebhook, expect.objectContaining({ redirect: "manual" }))
  })

  it("un 3xx cuenta como fallo y no refleja el body", async () => {
    fetchMock.mockResolvedValue(new Response("secreto interno", { status: 302, headers: { location: "http://10.0.0.1/" } }))
    const r = await dispatch("d1")
    expect(r.ok).toBe(false)
    expect(entrega()).toMatchObject({ status: "FAILED", http_status: 302 })
    expect(String(entrega()?.response_body)).not.toContain("secreto interno")
  })

  it("un 200 a un host público sigue funcionando", async () => {
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }))
    const r = await dispatch("d1")
    expect(r.ok).toBe(true)
    expect(entrega()).toMatchObject({ status: "SUCCESS", http_status: 200, response_body: "ok" })
  })
})
