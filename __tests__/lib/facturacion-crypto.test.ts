import { describe, it, expect, beforeAll } from "vitest"
import { encryptSecret, decryptSecret } from "@/lib/facturacion/crypto"

beforeAll(() => { process.env.FACTURACION_ENCRYPTION_KEY = "test-key-at-least-32-chars-long-xxxxx" })

describe("facturacion crypto", () => {
  it("round-trips a secret", () => {
    const enc = encryptSecret("my-api-token")
    expect(enc).not.toContain("my-api-token")
    expect(decryptSecret(enc)).toBe("my-api-token")
  })
  it("produces a different ciphertext each call (random IV)", () => {
    expect(encryptSecret("x")).not.toBe(encryptSecret("x"))
  })
  it("throws a descriptive error when decrypting an invalid payload", () => {
    expect(() => decryptSecret("garbage")).toThrow("payload cifrado inválido")
  })
  it("throws when FACTURACION_ENCRYPTION_KEY is not configured", () => {
    const previous = process.env.FACTURACION_ENCRYPTION_KEY
    delete process.env.FACTURACION_ENCRYPTION_KEY
    try {
      expect(() => encryptSecret("x")).toThrow("no configurada")
    } finally {
      process.env.FACTURACION_ENCRYPTION_KEY = previous
    }
  })
})
