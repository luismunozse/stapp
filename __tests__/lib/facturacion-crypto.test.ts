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
})
