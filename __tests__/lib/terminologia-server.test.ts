// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { getTerminologia } from "@/lib/terminologia-server"

function mockOrg(row: any, error: any = null) {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: row, error }),
  }
  vi.mocked(supabaseAdmin.from).mockReturnValue(chain as any)
}

describe("getTerminologia", () => {
  beforeEach(() => vi.clearAllMocks())

  it("aplica overrides de la org", async () => {
    mockOrg({ terminologia: { equipo: "Vehículo" } })
    const map = await getTerminologia("org-1")
    expect(map.equipo).toBe("Vehículo")
    expect(map.orden).toBe("Orden de trabajo") // default
  })

  it("fail-safe a defaults ante error de DB", async () => {
    mockOrg(null, { message: "boom" })
    const map = await getTerminologia("org-1")
    expect(map.equipo).toBe("Equipo")
  })
})
