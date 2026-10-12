import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"
import { PATCH } from "@/app/api/inventario/[id]/kit/route"

// Migration 177: CHECK (es_kit = false OR tipo_kit IS NOT NULL). The PATCH used to
// write tipo_kit = null and surface the CHECK violation as a 500.

const ctx = { params: Promise.resolve({ id: "inv-1" }) }
const MSG = "Un kit necesita un tipo: ensamblado o virtual"

function req(body: unknown) {
  return new Request("http://localhost:3000/api/inventario/inv-1/kit", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function setup(row: { es_kit: boolean; tipo_kit: string | null }) {
  mockAuthSuccess({ role: "ADMIN" })
  const chain = createChainMock({ id: "inv-1", ...row })
  mockSupabaseFrom({ inventario: chain })
  return chain
}

describe("PATCH /api/inventario/[id]/kit — tipo required for kits", () => {
  beforeEach(() => vi.clearAllMocks())

  it("rejects {esKit:true, tipoKit:null} with 400 and does not write", async () => {
    const inv = setup({ es_kit: false, tipo_kit: null })
    const { status, body } = await parseResponse(await PATCH(req({ esKit: true, tipoKit: null }), ctx))
    expect(status).toBe(400)
    expect(body.error).toBe(MSG)
    expect(inv.update).not.toHaveBeenCalled()
  })

  it("rejects {tipoKit:null} on an existing kit with 400", async () => {
    const inv = setup({ es_kit: true, tipo_kit: "VIRTUAL" })
    const { status, body } = await parseResponse(await PATCH(req({ tipoKit: null }), ctx))
    expect(status).toBe(400)
    expect(body.error).toBe(MSG)
    expect(inv.update).not.toHaveBeenCalled()
  })

  it("defaults to ENSAMBLADO when activating without tipo on a non-kit", async () => {
    const inv = setup({ es_kit: false, tipo_kit: null })
    const { status } = await parseResponse(await PATCH(req({ esKit: true }), ctx))
    expect(status).toBe(200)
    expect(inv.update).toHaveBeenCalledWith({ es_kit: true, tipo_kit: "ENSAMBLADO" })
  })

  it("allows turning a kit off", async () => {
    const inv = setup({ es_kit: true, tipo_kit: "VIRTUAL" })
    const { status } = await parseResponse(await PATCH(req({ esKit: false, tipoKit: null }), ctx))
    expect(status).toBe(200)
    expect(inv.update).toHaveBeenCalledWith({ es_kit: false, tipo_kit: null })
  })

  it("accepts an explicit tipo", async () => {
    const inv = setup({ es_kit: true, tipo_kit: "ENSAMBLADO" })
    const { status } = await parseResponse(await PATCH(req({ esKit: true, tipoKit: "VIRTUAL" }), ctx))
    expect(status).toBe(200)
    expect(inv.update).toHaveBeenCalledWith({ es_kit: true, tipo_kit: "VIRTUAL" })
  })

  it("scopes queries to the caller's organization", async () => {
    const inv = setup({ es_kit: true, tipo_kit: "ENSAMBLADO" })
    await PATCH(req({ esKit: true, tipoKit: "VIRTUAL" }), ctx)
    expect(inv.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })
})
