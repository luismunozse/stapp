// @vitest-environment node
import { describe, it, expect, afterEach, vi } from "vitest"

afterEach(() => {
  delete process.env.PDF_SMOKE
  vi.resetModules()
})

describe("GET /api/public/pdf-smoke", () => {
  it("404s when the smoke flag is not set, so production never exposes it", async () => {
    const { GET } = await import("@/app/api/public/pdf-smoke/route")
    const res = await GET()
    expect(res.status).toBe(404)
  })

  it("renders every react-pdf document when the flag is set", async () => {
    process.env.PDF_SMOKE = "1"
    const { GET } = await import("@/app/api/public/pdf-smoke/route")
    const res = await GET()
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.ok).toBe(true)
    // Every document must render to a real PDF, not an empty buffer.
    for (const [nombre, bytes] of Object.entries(body.documentos)) {
      expect(bytes, `${nombre} rendered nothing`).toBeGreaterThan(1000)
    }
    expect(Object.keys(body.documentos).sort()).toEqual(["reciboCC", "remito", "resumenCC"])
  })
})
