/**
 * Order exports use the same read scope as the order list
 * (`lib/ordenes/alcance-lectura.ts`):
 *  - ADMIN: every branch; the branch switcher narrows it.
 *  - VENDEDOR: only their current branch.
 *  - TECNICO: their current branch plus the orders assigned to them anywhere.
 *
 * Covers `ordenes` (direct filter) and `garantias` (filter through the embedded
 * order). The garantias query shape is pinned here: the embed that is filtered
 * must be declared `!inner` and be referenced by the SAME name in the filters.
 * Whether PostgREST really narrows the parent rows can only be proven against a
 * real database; these tests pin the shape that the order-linked lists already
 * run in production.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock } from "./helpers"
import { cookies } from "next/headers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
}))

import { GET } from "@/app/api/export/[entity]/route"

const S1 = "suc-A"
const USER = "user-tec"

function mockCookie(value: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn((name: string) =>
      name === "stapp-sucursal-activa" && value ? { value } : undefined
    ),
    set: vi.fn(),
  } as any)
}

function exportRequest(entity: string) {
  return {
    req: new NextRequest(`http://localhost:3000/api/export/${entity}`),
    ctx: { params: Promise.resolve({ entity }) },
  }
}

function cadena(data: any[] = []) {
  const chain = createChainMock(data)
  return chain
}

describe("GET /api/export/ordenes — same scope as the order list", () => {
  beforeEach(() => vi.clearAllMocks())

  async function exportar() {
    const chain = cadena()
    mockSupabaseFrom({ ordenes_servicio: chain })
    const { req, ctx } = exportRequest("ordenes")
    const res = await GET(req, ctx)
    expect(res.status).toBe(200)
    // Wrapped: returning the thenable chain itself would resolve it to its data.
    return { chain }
  }

  it("TECNICO gets own-branch orders plus the ones assigned to them elsewhere", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: USER, sucursalId: S1 })
    mockCookie(null)
    const { chain } = await exportar()
    expect(chain.or).toHaveBeenCalledWith(`sucursal_id.eq.${S1},tecnico_id.eq.${USER}`, undefined)
    expect(chain.eq).not.toHaveBeenCalledWith("sucursal_id", expect.anything())
  })

  it("VENDEDOR gets only their own branch", async () => {
    mockAuthSuccess({ role: "VENDEDOR", userId: "user-v", sucursalId: S1 })
    mockCookie(null)
    const { chain } = await exportar()
    expect(chain.eq).toHaveBeenCalledWith("sucursal_id", S1)
    expect(chain.or).not.toHaveBeenCalled()
  })

  it("ADMIN with the switcher on a branch gets that branch only", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-B")
    const { chain } = await exportar()
    expect(chain.eq).toHaveBeenCalledWith("sucursal_id", "suc-B")
    expect(chain.or).not.toHaveBeenCalled()
  })

  it("ADMIN without the switcher gets every branch", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie(null)
    const { chain } = await exportar()
    expect(chain.eq).not.toHaveBeenCalledWith("sucursal_id", expect.anything())
    expect(chain.or).not.toHaveBeenCalled()
  })
})

describe("GET /api/export/garantias — scope through the embedded order", () => {
  beforeEach(() => vi.clearAllMocks())

  const FILA = {
    dias_validez: 30,
    estado: "ACTIVA",
    ordenes_servicio: { numero_orden: 4417, dispositivo: "iPhone", cliente: { nombre: "Ana Prueba" } },
  }

  async function exportar() {
    const chain = cadena([FILA])
    mockSupabaseFrom({ garantias: chain })
    const { req, ctx } = exportRequest("garantias")
    const res = await GET(req, ctx)
    expect(res.status).toBe(200)
    return { chain, csv: await res.text() }
  }

  it("filters the embed by the name it is declared with, as an inner join", async () => {
    mockAuthSuccess({ role: "VENDEDOR", userId: "user-v", sucursalId: S1 })
    mockCookie(null)
    const { chain } = await exportar()
    const select: string = (chain.select as any).mock.calls[0][0]
    expect(select).toMatch(/ordenes_servicio!inner\s*\(/)
    // An alias on the filtered embed would make `ordenes_servicio.*` filters refer to nothing.
    expect(select).not.toMatch(/\w+\s*:\s*ordenes_servicio/)
    expect(chain.eq).toHaveBeenCalledWith("ordenes_servicio.organization_id", "org-1")
    expect(chain.eq).toHaveBeenCalledWith("ordenes_servicio.sucursal_id", S1)
  })

  it("keeps the order columns in the file", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie(null)
    const { csv } = await exportar()
    expect(csv).toContain("4417")
    expect(csv).toContain("Ana Prueba")
  })

  it("TECNICO: own branch or assigned, applied to the embedded order", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: USER, sucursalId: S1 })
    mockCookie(null)
    const { chain } = await exportar()
    expect(chain.or).toHaveBeenCalledWith(`sucursal_id.eq.${S1},tecnico_id.eq.${USER}`, {
      referencedTable: "ordenes_servicio",
    })
    expect(chain.eq).not.toHaveBeenCalledWith("ordenes_servicio.sucursal_id", expect.anything())
  })

  it("ADMIN with the switcher: that branch only", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-B")
    const { chain } = await exportar()
    expect(chain.eq).toHaveBeenCalledWith("ordenes_servicio.sucursal_id", "suc-B")
  })

  it("ADMIN without the switcher: every branch", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie(null)
    const { chain } = await exportar()
    expect(chain.eq).not.toHaveBeenCalledWith("ordenes_servicio.sucursal_id", expect.anything())
    expect(chain.or).not.toHaveBeenCalled()
  })
})
