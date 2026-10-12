// @vitest-environment node
import { describe, it, expect } from "vitest"
import {
  GRACE_DAYS, anonymizedEmail, isAnonymizedEmail, graceEndsAt, graceCutoff, isUserDeleted, isOrgDeleted, isLoginBlocked,
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

describe("isLoginBlocked", () => {
  const live = { deleted_at: null }
  const gone = { deleted_at: "2026-10-05T00:00:00Z" }
  const orgOk = { activo: true, deleted_at: null }

  it("deja pasar a un usuario vivo con taller activo (igual que antes)", () => {
    expect(isLoginBlocked(live, orgOk, { isSuper: false })).toBe(false)
    expect(isLoginBlocked({}, { activo: true }, { isSuper: false })).toBe(false)
  })

  it("bloquea al usuario dado de baja, también si es superadmin", () => {
    expect(isLoginBlocked(gone, orgOk, { isSuper: false })).toBe(true)
    expect(isLoginBlocked(gone, orgOk, { isSuper: true })).toBe(true)
  })

  it("bloquea si el taller está dado de baja", () => {
    expect(isLoginBlocked(live, { activo: true, deleted_at: "x" }, { isSuper: false })).toBe(true)
  })

  it("mantiene la semántica existente: taller inactivo o inexistente bloquea", () => {
    expect(isLoginBlocked(live, { activo: false, deleted_at: null }, { isSuper: false })).toBe(true)
    expect(isLoginBlocked(live, null, { isSuper: false })).toBe(true)
    expect(isLoginBlocked(live, undefined, { isSuper: false })).toBe(true)
  })

  it("el superadmin queda exento del chequeo de organización", () => {
    expect(isLoginBlocked(live, null, { isSuper: true })).toBe(false)
    expect(isLoginBlocked(live, { activo: false, deleted_at: "x" }, { isSuper: true })).toBe(false)
  })
})
