/**
 * GET /api/turnos/[id] applies the same branch scope the list does: a turno of
 * another branch answers like a missing one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { cookies } from "next/headers"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, createGetRequest, parseResponse } from "./helpers"

import { GET } from "@/app/api/turnos/[id]/route"

const S1 = "sucursal-1"
const S2 = "sucursal-2"
const U1 = "user-1"
const ctx = { params: Promise.resolve({ id: "turno-1" }) }

function turno(over: Record<string, unknown> = {}) {
  return {
    id: "turno-1",
    organization_id: "org-1",
    sucursal_id: S1,
    tecnico_id: U1,
    cliente_id: null,
    orden_id: null,
    inicio: "2026-08-01T10:00:00Z",
    fin: "2026-08-01T11:00:00Z",
    estado: "programado",
    clientes: null,
    users: null,
    ordenes_servicio: null,
    ...over,
  }
}

function mockCookie(value: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn((name: string) => (name === "stapp-sucursal-activa" && value ? { value } : undefined)),
    set: vi.fn(),
  } as any)
}

describe("GET /api/turnos/[id] branch scope", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookie(null)
  })

  it("a turno of the caller's branch is returned", async () => {
    mockSupabaseFrom({ turnos: createChainMock(turno()) })
    mockAuthSuccess({ role: "VENDEDOR", userId: "v-1", sucursalId: S1 })
    const { status } = await parseResponse(await GET(createGetRequest(), ctx))
    expect(status).toBe(200)
  })

  it("a turno of another branch answers like a missing one", async () => {
    mockSupabaseFrom({ turnos: createChainMock(turno({ sucursal_id: S2 })) })
    mockAuthSuccess({ role: "VENDEDOR", userId: "v-1", sucursalId: S1 })
    const { status, body } = await parseResponse(await GET(createGetRequest(), ctx))
    expect(status).toBe(404)
    expect(body.error).toBe("No encontrado")
  })

  it("TECNICO: own turno of another branch is out of scope too (same as the list)", async () => {
    mockSupabaseFrom({ turnos: createChainMock(turno({ sucursal_id: S2 })) })
    mockAuthSuccess({ role: "TECNICO", userId: U1, sucursalId: S1 })
    const { status } = await parseResponse(await GET(createGetRequest(), ctx))
    expect(status).toBe(404)
  })

  it("ADMIN viewing all branches reads any turno", async () => {
    mockSupabaseFrom({ turnos: createChainMock(turno({ sucursal_id: S2 })) })
    mockAuthSuccess({ role: "ADMIN" })
    const { status } = await parseResponse(await GET(createGetRequest(), ctx))
    expect(status).toBe(200)
  })

  it("ADMIN with a branch selected only reads that branch", async () => {
    mockCookie(S1)
    mockSupabaseFrom({ turnos: createChainMock(turno({ sucursal_id: S2 })) })
    mockAuthSuccess({ role: "ADMIN" })
    const { status } = await parseResponse(await GET(createGetRequest(), ctx))
    expect(status).toBe(404)
  })
})
