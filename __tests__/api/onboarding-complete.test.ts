import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"
import { POST } from "@/app/api/onboarding/complete/route"

function preparar() {
  const organizations = createChainMock(null)
  const progreso = createChainMock(null)
  const update = vi.fn().mockReturnValue(progreso)
  progreso.update = update
  mockSupabaseFrom({ organizations, onboarding_progress: progreso })
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: "real", error: null } as any)
  return { organizations, progreso, update }
}

function pedido(body?: string) {
  return new Request("http://localhost/api/onboarding/complete", {
    method: "POST",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body }),
  })
}

describe("POST /api/onboarding/complete", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it("completes without a body, as the current wizard calls it", async () => {
    const { organizations, update } = preparar()
    const { status } = await parseResponse(await POST(pedido()))
    expect(status).toBe(200)
    expect(organizations.update).toHaveBeenCalledWith({ onboarding_completed: true })
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0][0]).toHaveProperty("completed_at")
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  // Row missing or present is one SQL statement (registrar_camino_onboarding,
  // an upsert by organization_id), so the route has one path for both. These
  // tests pin that every camino goes through it, never through a plain
  // UPDATE that matches 0 rows when the row is missing.
  it("records camino real with the upserting function", async () => {
    const { update } = preparar()
    const { status } = await parseResponse(await POST(pedido(JSON.stringify({ camino: "real" }))))
    expect(status).toBe(200)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("registrar_camino_onboarding", {
      p_org_id: "org-1",
      p_camino: "real",
    })
    expect(update.mock.calls.some(([c]: any[]) => "camino" in c)).toBe(false)
  })

  it("records camino omitido with the upserting function", async () => {
    const { update } = preparar()
    await POST(pedido(JSON.stringify({ camino: "omitido" })))
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("registrar_camino_onboarding", {
      p_org_id: "org-1",
      p_camino: "omitido",
    })
    expect(update.mock.calls.some(([c]: any[]) => "camino" in c)).toBe(false)
  })

  // The upsert creates the progress row when missing; the plain UPDATE of
  // completed_at matches 0 rows otherwise, so the camino must be written first.
  it("records the camino before stamping completed_at", async () => {
    const { update } = preparar()
    await POST(pedido(JSON.stringify({ camino: "real" })))
    const rpcOrder = vi.mocked(supabaseAdmin.rpc).mock.invocationCallOrder[0]
    expect(rpcOrder).toBeLessThan(update.mock.invocationCallOrder[0])
  })

  it("still completes when recording the camino fails", async () => {
    preparar()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: { message: "rpc down" } } as any)
    expect((await POST(pedido(JSON.stringify({ camino: "real" })))).status).toBe(200)
  })

  it("rejects a camino the wizard cannot send", async () => {
    const { organizations } = preparar()
    const { status } = await parseResponse(await POST(pedido(JSON.stringify({ camino: "practica" }))))
    expect(status).toBe(400)
    expect(organizations.update).not.toHaveBeenCalled()
  })

  it("rejects malformed JSON", async () => {
    preparar()
    expect((await POST(pedido("{"))).status).toBe(400)
  })

  it("returns 403 for a non-admin", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })
    expect((await POST(pedido())).status).toBe(403)
  })
})
