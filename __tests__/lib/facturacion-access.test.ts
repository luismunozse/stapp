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
  return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }
}
function credRowError(error: any) {
  return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error }) }) }) }
}

describe("canEmitirFacturaElectronica", () => {
  beforeEach(() => vi.clearAllMocks())
  it("false when plan lacks the feature", async () => {
    ;(hasPlanFeature as any).mockResolvedValue(false)
    expect(await canEmitirFacturaElectronica("o1")).toBe(false)
  })
  it("true when provider='tusfacturas' and all conditions hold", async () => {
    ;(hasPlanFeature as any).mockResolvedValue(true)
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(orgRow({ pais: "AR", facturacion_electronica_habilitada: true }))
      .mockReturnValueOnce(credRow({ organization_id: "o1", provider: "tusfacturas" }))
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

  // P1a regression (review PR2, engram #1125): emission is only implemented
  // for the tusfacturas provider until Phase 4 ships ArcaDirectProvider. An
  // `arca`-provider row has NULL legacy token columns (migration 299 made
  // them nullable specifically for arca-only rows) — if this function
  // returned true for it, app/api/facturacion-electronica/emitir/route.ts
  // would reach `decryptSecret(cred.apitoken_enc)` with `apitoken_enc: null`
  // and throw an unhandled TypeError. This is the ONLY thing standing
  // between an admin saving arca credentials and that crash: emitir/route.ts
  // is not touched, it just trusts this gate.
  it("false when provider='arca' (emission not wired for arca until Phase 4 — prevents the decryptSecret(null) crash)", async () => {
    ;(hasPlanFeature as any).mockResolvedValue(true)
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(orgRow({ pais: "AR", facturacion_electronica_habilitada: true }))
      .mockReturnValueOnce(
        credRow({
          organization_id: "o1",
          provider: "arca",
          apitoken_enc: null,
          apikey_enc: null,
          usertoken_enc: null,
        })
      )
    expect(await canEmitirFacturaElectronica("o1")).toBe(false)
  })

  it("false when provider='arca' even with a certificate that has not expired (provider gate wins, not a cert check)", async () => {
    ;(hasPlanFeature as any).mockResolvedValue(true)
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(orgRow({ pais: "AR", facturacion_electronica_habilitada: true }))
      .mockReturnValueOnce(
        credRow({ organization_id: "o1", provider: "arca", cert_not_after: "2099-01-01T00:00:00Z" })
      )
    expect(await canEmitirFacturaElectronica("o1")).toBe(false)
  })

  // Tier-A degradation (design ADR-13): migration 299 not applied yet ->
  // fall back to the pre-299 existence-only check. Every row on that schema
  // is implicitly tusfacturas (arca didn't exist before 299), so this stays
  // an existence check, not a provider check.
  it("degrades tier-A when migration 299 hasn't landed (42703 on provider) — existence-only, matches pre-299 behavior", async () => {
    ;(hasPlanFeature as any).mockResolvedValue(true)
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(orgRow({ pais: "AR", facturacion_electronica_habilitada: true }))
      .mockReturnValueOnce(
        credRowError({ code: "42703", message: "column facturacion_credenciales.provider does not exist" })
      )
      .mockReturnValueOnce(credRow({ organization_id: "o1" }))
    expect(await canEmitirFacturaElectronica("o1")).toBe(true)
  })

  it("degrades tier-A to false when the fallback also finds no row", async () => {
    ;(hasPlanFeature as any).mockResolvedValue(true)
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(orgRow({ pais: "AR", facturacion_electronica_habilitada: true }))
      .mockReturnValueOnce(credRowError({ code: "PGRST204", message: "schema cache" }))
      .mockReturnValueOnce(credRow(null))
    expect(await canEmitirFacturaElectronica("o1")).toBe(false)
  })
})
