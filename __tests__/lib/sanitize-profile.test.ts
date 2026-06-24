import { describe, it, expect } from "vitest"
import { sanitizeName, sanitizeAvatarUrl } from "@/lib/sanitize-profile"

describe("sanitizeName", () => {
  it("strips < and > characters", () => {
    const result = sanitizeName('<img onerror="alert(1)">')
    expect(result).not.toContain("<")
    expect(result).not.toContain(">")
  })

  it("returns trimmed string for a normal name", () => {
    expect(sanitizeName("  Alice  ")).toBe("Alice")
  })

  it("returns null for empty string after strip+trim", () => {
    expect(sanitizeName("   ")).toBeNull()
    expect(sanitizeName("<>")).toBeNull()
  })

  it("caps at 100 characters", () => {
    const long = "a".repeat(200)
    expect(sanitizeName(long)!.length).toBe(100)
  })

  it("returns null for non-string input", () => {
    expect(sanitizeName(null)).toBeNull()
    expect(sanitizeName(42)).toBeNull()
    expect(sanitizeName(undefined)).toBeNull()
  })
})

describe("sanitizeAvatarUrl", () => {
  it("rejects javascript: URLs", () => {
    expect(sanitizeAvatarUrl("javascript:alert(1)")).toBeNull()
  })

  it("rejects data: URLs", () => {
    expect(sanitizeAvatarUrl("data:text/html,<h1>xss</h1>")).toBeNull()
  })

  it("rejects blob: URLs", () => {
    expect(sanitizeAvatarUrl("blob:http://localhost/xxx")).toBeNull()
  })

  it("accepts valid https URLs", () => {
    const url = "https://cdn.example.com/avatar.jpg"
    expect(sanitizeAvatarUrl(url)).toBe(url)
  })

  it("accepts valid http URLs", () => {
    const url = "http://cdn.example.com/avatar.jpg"
    expect(sanitizeAvatarUrl(url)).toBe(url)
  })

  it("returns null for URLs exceeding 500 characters", () => {
    const long = "https://example.com/" + "a".repeat(490)
    expect(sanitizeAvatarUrl(long)).toBeNull()
  })

  it("returns null for non-string input", () => {
    expect(sanitizeAvatarUrl(null)).toBeNull()
    expect(sanitizeAvatarUrl(undefined)).toBeNull()
  })
})
