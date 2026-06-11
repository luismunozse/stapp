import { describe, it, expect } from "vitest"
import { createHash } from "crypto"
import { generateApiKey, hashApiKey } from "@/lib/api-keys"

describe("api-keys", () => {
  it("generateApiKey returns raw/hash/prefix that agree", () => {
    const { raw, hash, prefix } = generateApiKey()
    expect(raw.startsWith("stapp_live_")).toBe(true)
    expect(raw.length).toBe("stapp_live_".length + 32) // 16 bytes hex
    expect(hash).toBe(createHash("sha256").update(raw).digest("hex"))
    expect(prefix).toBe(raw.slice(0, 18))
  })

  it("hashApiKey is deterministic and matches sha256", () => {
    const v = "stapp_live_deadbeefdeadbeefdeadbeefdeadbeef"
    expect(hashApiKey(v)).toBe(createHash("sha256").update(v).digest("hex"))
    expect(hashApiKey(v)).toBe(hashApiKey(v))
  })

  it("two generated keys differ", () => {
    expect(generateApiKey().raw).not.toBe(generateApiKey().raw)
  })
})
