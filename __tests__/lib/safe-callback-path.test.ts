// @vitest-environment node
import { describe, it, expect } from "vitest"
import { safeCallbackPath } from "@/lib/safe-callback-path"

describe("safeCallbackPath", () => {
  it.each([
    ["/perfil#eliminar", "/perfil#eliminar"],
    ["/ordenes?estado=abierta", "/ordenes?estado=abierta"],
    ["/perfil", "/perfil"],
    ["/ordenes/abc-123?a=1&b=2#x", "/ordenes/abc-123?a=1&b=2#x"],
    ["/loginfoo", "/loginfoo"],
  ])("acepta la ruta relativa %s", (raw, esperado) => expect(safeCallbackPath(raw)).toBe(esperado))

  it.each([
    null, undefined, "", "/", "/login", "/login?x=1", "/login/", "/registro", "/registro?x=1", "/api", "/api/users/profile",
    "//evil.com", "//evil.com/x", "/\\evil.com", "\\\\evil.com",
    "https://evil.com", "http://evil.com", "javascript:alert(1)", "data:text/html,x", "perfil",
    "/ok\n//evil.com", "/\tevil.com", "/ ok", "/ok\u0000",
    "/%2F%2Fevil.com", "/%5Cevil.com", "/%09/evil.com", "/%0a/evil.com", "/%0d/evil.com", "/%20x", "/%E0%A4%A",
    "/%2Flogin", "/%2Fapi/x", "/%6Cogin", "/%61pi/x",
  ])("rechaza %j y cae al dashboard", (raw) => expect(safeCallbackPath(raw as string | null | undefined)).toBe("/dashboard"))

  it("acepta un fallback propio", () => {
    expect(safeCallbackPath("//evil.com", "/inicio")).toBe("/inicio")
  })
})
