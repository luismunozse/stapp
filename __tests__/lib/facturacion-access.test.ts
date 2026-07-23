import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/subscriptions", () => ({ hasPlanFeature: vi.fn() }))
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: vi.fn() } }))

import { hasPlanFeature } from "@/lib/subscriptions"
import { supabaseAdmin } from "@/lib/supabase"
import { canEmitirFacturaElectronica } from "@/lib/facturacion/access"

function orgRow(row: any) {
  return { select: () => ({ eq: () => ({ single: async () => ({ data: row }) }) }) }
}
function credRow(row: any) {
  return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }) }
}

describe("canEmitirFacturaElectronica", () => {
  beforeEach(() => vi.clearAllMocks())
  it("false when plan lacks the feature", async () => {
    ;(hasPlanFeature as any).mockResolvedValue(false)
    expect(await canEmitirFacturaElectronica("o1")).toBe(false)
  })
  it("true when all conditions hold", async () => {
    ;(hasPlanFeature as any).mockResolvedValue(true)
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(orgRow({ pais: "AR", facturacion_electronica_habilitada: true }))
      .mockReturnValueOnce(credRow({ organization_id: "o1" }))
    expect(await canEmitirFacturaElectronica("o1")).toBe(true)
  })
  it("false when pais != AR", async () => {
    ;(hasPlanFeature as any).mockResolvedValue(true)
    ;(supabaseAdmin.from as any).mockReturnValueOnce(orgRow({ pais: "MX", facturacion_electronica_habilitada: true }))
    expect(await canEmitirFacturaElectronica("o1")).toBe(false)
  })
  it("false when facturacion_electronica_habilitada is toggled off", async () => {
    ;(hasPlanFeature as any).mockResolvedValue(true)
    ;(supabaseAdmin.from as any).mockReturnValueOnce(orgRow({ pais: "AR", facturacion_electronica_habilitada: false }))
    expect(await canEmitirFacturaElectronica("o1")).toBe(false)
  })
  it("false when no credentials row exists", async () => {
    ;(hasPlanFeature as any).mockResolvedValue(true)
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(orgRow({ pais: "AR", facturacion_electronica_habilitada: true }))
      .mockReturnValueOnce(credRow(null))
    expect(await canEmitirFacturaElectronica("o1")).toBe(false)
  })
  it("fails closed to false when hasPlanFeature throws", async () => {
    ;(hasPlanFeature as any).mockRejectedValue(new Error("boom"))
    expect(await canEmitirFacturaElectronica("o1")).toBe(false)
  })
})
