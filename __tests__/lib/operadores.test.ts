// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { resolveOperador } from "@/lib/operadores"

function mockUser(row: any) {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
  }
  vi.mocked(supabaseAdmin.from).mockReturnValue(chain as any)
}

describe("resolveOperador", () => {
  beforeEach(() => vi.clearAllMocks())

  it("sin actorId => fallback", async () => {
    expect(await resolveOperador("org-1", null, "sess-1")).toBe("sess-1")
    expect(await resolveOperador("org-1", undefined, "sess-1")).toBe("sess-1")
  })

  it("actor válido y activo => actorId", async () => {
    mockUser({ id: "u2", rol: "VENDEDOR", activo: true })
    expect(await resolveOperador("org-1", "u2", "sess-1")).toBe("u2")
  })

  it("actor inactivo => fallback", async () => {
    mockUser({ id: "u2", rol: "VENDEDOR", activo: false })
    expect(await resolveOperador("org-1", "u2", "sess-1")).toBe("sess-1")
  })

  it("actor inexistente / otra org => fallback", async () => {
    mockUser(null)
    expect(await resolveOperador("org-1", "u9", "sess-1")).toBe("sess-1")
  })

  it("rol no permitido => fallback", async () => {
    mockUser({ id: "u2", rol: "TECNICO", activo: true })
    expect(await resolveOperador("org-1", "u2", "sess-1", { roles: ["VENDEDOR", "ADMIN"] })).toBe("sess-1")
  })
})
