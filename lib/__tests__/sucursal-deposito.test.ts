import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { getDepositoDeSucursal } from "@/lib/sucursal"

describe("getDepositoDeSucursal", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns the principal deposito id when one exists", async () => {
    const chain: any = {}
    const methods = ["select", "eq", "is"]
    for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain)
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "dep-principal" }, error: null })
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain as any)

    const result = await getDepositoDeSucursal("org-1", "suc-1")

    expect(result).toBe("dep-principal")
    expect(supabaseAdmin.from).toHaveBeenCalledWith("depositos")
    expect(chain.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(chain.eq).toHaveBeenCalledWith("sucursal_id", "suc-1")
    expect(chain.eq).toHaveBeenCalledWith("principal", true)
    expect(chain.is).toHaveBeenCalledWith("deleted_at", null)
  })

  it("returns null when sucursal has no principal deposito", async () => {
    const chain: any = {}
    const methods = ["select", "eq", "is"]
    for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain)
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain as any)

    const result = await getDepositoDeSucursal("org-1", "suc-sin-deposito")

    expect(result).toBeNull()
  })

  it("returns null when supabase returns an error, and warns instead of swallowing it", async () => {
    const chain: any = {}
    const methods = ["select", "eq", "is"]
    for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain)
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: { message: "DB error" } })
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain as any)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    const result = await getDepositoDeSucursal("org-1", "suc-1")

    // A failed lookup is indistinguishable from "this sucursal has no principal
    // deposito" by the return value alone — callers that only need the id keep
    // the drain-mode fallback, but the failure must not be silent.
    expect(result).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Could not resolve the principal deposito"))
    warn.mockRestore()
  })
})
