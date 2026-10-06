// @vitest-environment node
import { describe, it, expect } from "vitest"
import {
  GRACE_DAYS, anonymizedEmail, isAnonymizedEmail, graceEndsAt, graceCutoff, isUserDeleted, isOrgDeleted,
} from "@/lib/account-deletion/state"

describe("account-deletion/state", () => {
  it("la gracia es de 30 días", () => {
    expect(GRACE_DAYS).toBe(30)
  })

  it("arma y reconoce el email descartable", () => {
    expect(anonymizedEmail("abc123")).toBe("deleted+abc123@deleted.stapp.invalid")
    expect(isAnonymizedEmail("deleted+abc123@deleted.stapp.invalid")).toBe(true)
    expect(isAnonymizedEmail("juan@gmail.com")).toBe(false)
    expect(isAnonymizedEmail(null)).toBe(false)
  })

  it("graceEndsAt suma 30 días en UTC", () => {
    expect(graceEndsAt("2026-10-05T12:00:00.000Z").toISOString()).toBe("2026-11-04T12:00:00.000Z")
  })

  it("graceCutoff resta 30 días", () => {
    expect(graceCutoff(new Date("2026-11-04T12:00:00.000Z")).toISOString()).toBe("2026-10-05T12:00:00.000Z")
  })

  it("isUserDeleted / isOrgDeleted miran deleted_at y toleran null/undefined", () => {
    expect(isUserDeleted({ deleted_at: "2026-10-05T00:00:00Z" })).toBe(true)
    expect(isUserDeleted({ deleted_at: null })).toBe(false)
    expect(isUserDeleted(undefined)).toBe(false)
    expect(isOrgDeleted({ deleted_at: "x" })).toBe(true)
    expect(isOrgDeleted(null)).toBe(false)
  })
})
