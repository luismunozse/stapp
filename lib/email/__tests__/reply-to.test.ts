import { describe, it, expect } from "vitest"
import { replyToDelTaller } from "../reply-to"

describe("replyToDelTaller", () => {
  it("devuelve la direccion limpia de espacios", () => {
    expect(replyToDelTaller("  taller@example.com ")).toBe("taller@example.com")
  })

  it("devuelve undefined para null, undefined y vacio", () => {
    expect(replyToDelTaller(null)).toBeUndefined()
    expect(replyToDelTaller(undefined)).toBeUndefined()
    expect(replyToDelTaller("")).toBeUndefined()
    expect(replyToDelTaller("   ")).toBeUndefined()
  })

  it.each([
    "sin-arroba",
    "a@b",
    "a b@example.com",
    "a@example.com, b@example.com",
    "a@example.com;b@example.com",
    "Taller <a@example.com>",
    "<a@example.com>",
    "a@example.com\r\nBcc: x@y.com",
    "a@example.com\nBcc: x@y.com",
    "@example.com",
    "a@@example.com",
    "a@..com",
    "a@example..com",
    "a@.example.com",
    "a@example.com.",
    "a@-x.y",
    "a@x-.y",
    "a@example.-com",
    "a@example.c",
    "a@example.c0m",
    "a@example.123",
    "a@exa_mple.com",
    "a\u0000b@example.com",
    "a\u007f@example.com",
    "a\tb@example.com",
    `${"a".repeat(250)}@example.com`,
  ])("rechaza %j", (valor) => {
    expect(replyToDelTaller(valor)).toBeUndefined()
  })

  it.each([
    "taller+ordenes@example.com",
    "taller@mail.sub.example.com",
    "taller@my-taller.com.ar",
    "t.a.l@example.io",
    "taller@xn--caf-dma.com",
  ])("acepta %j", (valor) => {
    expect(replyToDelTaller(valor)).toBe(valor)
  })

  it("acepta una direccion de exactamente 254 caracteres", () => {
    const local = "a".repeat(254 - "@example.com".length)
    const valor = `${local}@example.com`
    expect(valor).toHaveLength(254)
    expect(replyToDelTaller(valor)).toBe(valor)
  })
})
