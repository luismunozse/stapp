/**
 * Warranties follow the branch scope of the order they belong to.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  parseResponse,
} from "./helpers"

import { GET as listGarantias } from "@/app/api/garantias/route"
import { GET as getGarantia } from "@/app/api/garantias/[id]/route"
import { GET as exportEntity } from "@/app/api/export/[entity]/route"

const S1 = "sucursal-1"
const U1 = "user-1"
const REF = { referencedTable: "ordenes_servicio" }

describe("GET /api/garantias", () => {
  let garantias: ReturnType<typeof createChainMock>
  beforeEach(() => {
    garantias = createChainMock([])
    mockSupabaseFrom({ garantias })
  })

  it("ADMIN: no branch filter", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    await listGarantias(createGetRequest())
    expect(garantias.or).not.toHaveBeenCalled()
    expect(garantias.eq).not.toHaveBeenCalledWith("ordenes_servicio.sucursal_id", expect.anything())
  })

  it("VENDEDOR: filtered by the order's branch", async () => {
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    await listGarantias(createGetRequest())
    expect(garantias.eq).toHaveBeenCalledWith("ordenes_servicio.sucursal_id", S1)
  })

  it("TECNICO: branch or assigned orders", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: U1, sucursalId: S1 })
    await listGarantias(createGetRequest())
    expect(garantias.or).toHaveBeenCalledWith(`sucursal_id.eq.${S1},tecnico_id.eq.${U1}`, REF)
  })
})

describe("GET /api/garantias/[id]", () => {
  const ctx = { params: Promise.resolve({ id: "gar-1" }) }
  let garantias: ReturnType<typeof createChainMock>
  beforeEach(() => {
    garantias = createChainMock(null, { message: "no rows" })
    mockSupabaseFrom({ garantias })
  })

  it("out of scope answers 404 with the not-found text", async () => {
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    const { status, body } = await parseResponse(await getGarantia(createGetRequest(), ctx))
    expect(garantias.eq).toHaveBeenCalledWith("ordenes_servicio.sucursal_id", S1)
    expect(status).toBe(404)
    expect(body.error).toBe("Garantía no encontrada")
  })

  it("TECNICO scope uses or()", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: U1, sucursalId: S1 })
    await getGarantia(createGetRequest(), ctx)
    expect(garantias.or).toHaveBeenCalledWith(`sucursal_id.eq.${S1},tecnico_id.eq.${U1}`, REF)
  })

  it("ADMIN: no branch filter", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    await getGarantia(createGetRequest(), ctx)
    expect(garantias.or).not.toHaveBeenCalled()
    expect(garantias.eq).not.toHaveBeenCalledWith("ordenes_servicio.sucursal_id", expect.anything())
  })
})

describe("GET /api/export/garantias", () => {
  const ctx = { params: Promise.resolve({ entity: "garantias" }) }
  let garantias: ReturnType<typeof createChainMock>
  beforeEach(() => {
    garantias = createChainMock([])
    mockSupabaseFrom({ garantias })
  })

  it("VENDEDOR: export limited to the order's branch", async () => {
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    await exportEntity(new NextRequest("http://localhost/api/export/garantias"), ctx)
    expect(garantias.eq).toHaveBeenCalledWith("ordenes_servicio.sucursal_id", S1)
  })

  it("TECNICO: branch or assigned", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: U1, sucursalId: S1 })
    await exportEntity(new NextRequest("http://localhost/api/export/garantias"), ctx)
    expect(garantias.or).toHaveBeenCalledWith(`sucursal_id.eq.${S1},tecnico_id.eq.${U1}`, REF)
  })

  it("ADMIN: unfiltered", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    await exportEntity(new NextRequest("http://localhost/api/export/garantias"), ctx)
    expect(garantias.or).not.toHaveBeenCalled()
  })
})
