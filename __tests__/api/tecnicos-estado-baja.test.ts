/**
 * PATCH /api/tecnicos/[id]/estado must not touch a technician that was removed
 * (deleted_at set): it answers 404 and never flips `activo`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock } from "./helpers"
import { PATCH } from "@/app/api/tecnicos/[id]/estado/route"

function call(body: unknown) {
  const req = new Request("http://localhost:3000/api/tecnicos/t1/estado", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  return PATCH(req, { params: Promise.resolve({ id: "t1" }) })
}

describe("PATCH /api/tecnicos/[id]/estado — removed technicians", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
  })

  it("looks the technician up excluding removed ones and returns 404 when not found", async () => {
    const users = createChainMock(null, { message: "no rows" })
    mockSupabaseFrom({ users })
    const res = await call({ activo: true })
    expect(res.status).toBe(404)
    expect(users.is).toHaveBeenCalledWith("deleted_at", null)
    expect(users.update).not.toHaveBeenCalled()
  })

  it("also excludes removed users from the update", async () => {
    const users = createChainMock({ id: "t1", activo: false, ordenes_servicio: [] }, null)
    mockSupabaseFrom({ users })
    const res = await call({ activo: true })
    expect(res.status).toBe(200)
    expect(users.update).toHaveBeenCalledWith({ activo: true })
    expect(users.is).toHaveBeenCalledTimes(2)
    expect(users.is).toHaveBeenNthCalledWith(2, "deleted_at", null)
  })
})
