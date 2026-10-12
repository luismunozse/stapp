// @vitest-environment node
import { describe, it, expect } from "vitest"
import { createChainMock, mockSupabaseFrom } from "../../api/helpers"
import { organizationAcceptsBilling } from "@/lib/account-deletion/org-state"

describe("organizationAcceptsBilling", () => {
  it("true para una org viva", async () => {
    mockSupabaseFrom({ organizations: createChainMock({ id: "o1", deleted_at: null }, null) })
    expect(await organizationAcceptsBilling("o1")).toBe(true)
  })
  it("false si está archivada o en gracia (deleted_at)", async () => {
    mockSupabaseFrom({ organizations: createChainMock({ id: "o1", deleted_at: "2026-10-05" }, null) })
    expect(await organizationAcceptsBilling("o1")).toBe(false)
  })
  it("false si ya no existe (purgada)", async () => {
    mockSupabaseFrom({ organizations: createChainMock(null, null) })
    expect(await organizationAcceptsBilling("o1")).toBe(false)
  })
  it("tira si la lectura falla, para que el proveedor reintente", async () => {
    mockSupabaseFrom({ organizations: createChainMock(null, { message: "down" }) })
    await expect(organizationAcceptsBilling("o1")).rejects.toThrow(/down/)
  })
})
