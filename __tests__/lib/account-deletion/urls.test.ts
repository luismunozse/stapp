// @vitest-environment node
import { describe, it, expect } from "vitest"
import { isValidTenantSlug, buildDeletionLoginUrl } from "@/lib/account-deletion/urls"

describe("isValidTenantSlug", () => {
  it.each([["taller-uno", true], ["  Taller-Uno ", true], ["a", true], ["-malo", false], ["malo-", false], ["con espacio", false], ["", false], ["acentó", false], ["a.b", false]])(
    "%j -> %s",
    (raw, ok) => expect(isValidTenantSlug(raw)).toBe(ok)
  )
})

describe("buildDeletionLoginUrl", () => {
  it("lleva al login del taller con callback a la Zona de peligro", () => {
    const url = buildDeletionLoginUrl("taller-uno", "stapp.com.ar")
    expect(url).toBe("https://taller-uno.stapp.com.ar/login?callbackUrl=%2Fperfil%23eliminar")
    expect(new URL(url).searchParams.get("callbackUrl")).toBe("/perfil#eliminar")
  })
})
