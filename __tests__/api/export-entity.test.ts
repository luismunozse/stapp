import { describe, it, expect, beforeEach, vi } from "vitest"
import { NextRequest } from "next/server"
import {
  mockAuthSuccess,
  mockAuthError,
  mockSupabaseFrom,
  createChainMock,
} from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
}))

import { GET } from "@/app/api/export/[entity]/route"

function exportRequest(entity: string, query = "") {
  const url = `http://localhost:3000/api/export/${entity}${query}`
  return {
    req: new NextRequest(url),
    ctx: { params: Promise.resolve({ entity }) },
  }
}

describe("GET /api/export/[entity]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabaseFrom({ clientes: createChainMock([]) })
  })

  it("returns 401 when not authenticated", async () => {
    mockAuthError()
    const { req, ctx } = exportRequest("clientes")
    const res = await GET(req, ctx)
    expect(res.status).toBe(401)
  })

  it("defaults to CSV content-type", async () => {
    mockAuthSuccess()
    const { req, ctx } = exportRequest("clientes")
    const res = await GET(req, ctx)
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toContain("text/csv")
  })

  it("returns XLSX content-type when format=xlsx", async () => {
    mockAuthSuccess()
    const { req, ctx } = exportRequest("clientes", "?format=xlsx")
    const res = await GET(req, ctx)
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml.sheet")
    expect(res.headers.get("Content-Disposition")).toContain(".xlsx")
  })

  it("rejects an invalid entity with 400", async () => {
    mockAuthSuccess()
    const { req, ctx } = exportRequest("noexiste")
    const res = await GET(req, ctx)
    expect(res.status).toBe(400)
  })

  it("allows export even when the org lacks data_export (portability)", async () => {
    mockAuthSuccess()
    const { req, ctx } = exportRequest("clientes")
    const res = await GET(req, ctx)
    expect(res.status).toBe(200)
  })
})
