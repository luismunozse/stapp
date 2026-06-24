import { describe, it, expect } from "vitest"
import { escapeHtml } from "@/lib/escape-html"

describe("escapeHtml", () => {
  it("escapes <", () => {
    expect(escapeHtml("<div>")).toBe("&lt;div&gt;")
  })

  it("escapes >", () => {
    expect(escapeHtml("a > b")).toBe("a &gt; b")
  })

  it("escapes &", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b")
  })

  it('escapes "', () => {
    expect(escapeHtml('say "hello"')).toBe("say &quot;hello&quot;")
  })

  it("escapes '", () => {
    expect(escapeHtml("it's")).toBe("it&#39;s")
  })

  it("escapes all five chars together", () => {
    expect(escapeHtml(`<script>alert("it's a & b")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;it&#39;s a &amp; b&quot;)&lt;/script&gt;"
    )
  })

  it("returns empty string for null input", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(escapeHtml(null as any)).toBe("")
  })

  it("returns empty string for undefined input", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(escapeHtml(undefined as any)).toBe("")
  })

  it("returns the same string when there is nothing to escape", () => {
    expect(escapeHtml("hello world")).toBe("hello world")
  })

  it("handles empty string", () => {
    expect(escapeHtml("")).toBe("")
  })
})
