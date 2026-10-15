// @vitest-environment node
import { describe, it, expect } from "vitest"
import {
  ORDEN_PAPEL_DEFAULT,
  ORDEN_PAPEL_OPCIONES,
  ORDEN_PAGE_POINTS,
  normalizeOrdenPapel,
  parseOrdenPapel,
  resolveOrdenPapel,
} from "@/lib/orden-papel"

describe("normalizeOrdenPapel: anything that is not a known size is A4", () => {
  it("keeps the three known sizes, case and spaces aside", () => {
    expect(normalizeOrdenPapel("A4")).toBe("A4")
    expect(normalizeOrdenPapel("A5")).toBe("A5")
    expect(normalizeOrdenPapel("A6")).toBe("A6")
    expect(normalizeOrdenPapel(" a6 ")).toBe("A6")
  })

  it("falls back to A4 for a missing column, null, an unknown size and non strings", () => {
    for (const bad of [undefined, null, "", "A3", "LEGAL", "A 6", 6, {}, ["A6"], false]) {
      expect(normalizeOrdenPapel(bad)).toBe("A4")
    }
    expect(ORDEN_PAPEL_DEFAULT).toBe("A4")
  })
})

describe("parseOrdenPapel: strict version for what a client SENDS", () => {
  it("returns the size for a valid one and null for anything else (so the API can ignore it)", () => {
    expect(parseOrdenPapel("A5")).toBe("A5")
    expect(parseOrdenPapel("a6")).toBe("A6")
    expect(parseOrdenPapel("A3")).toBeNull()
    expect(parseOrdenPapel(undefined)).toBeNull()
    expect(parseOrdenPapel(5)).toBeNull()
  })
})

describe("resolveOrdenPapel: the size of THIS print", () => {
  it("uses the one asked for this print when it is valid", () => {
    expect(resolveOrdenPapel("A6", "A4")).toBe("A6")
    expect(resolveOrdenPapel("A4", "A6")).toBe("A4")
  })

  it("uses the organization default when nothing valid was asked for", () => {
    expect(resolveOrdenPapel(null, "A5")).toBe("A5")
    expect(resolveOrdenPapel("", "A6")).toBe("A6")
    expect(resolveOrdenPapel("A3", "A5")).toBe("A5")
  })

  it("is A4 when neither exists (column missing, nothing asked)", () => {
    expect(resolveOrdenPapel(undefined, undefined)).toBe("A4")
    expect(resolveOrdenPapel(null, "garbage")).toBe("A4")
  })
})

describe("page sizes in PDF points", () => {
  it("A4 595x842, A5 420x595, A6 298x420", () => {
    expect(ORDEN_PAGE_POINTS.A4).toEqual([595, 842])
    expect(ORDEN_PAGE_POINTS.A5).toEqual([420, 595])
    expect(ORDEN_PAGE_POINTS.A6).toEqual([298, 420])
  })

  it("every option offered to the user has a size and a Spanish label", () => {
    expect(ORDEN_PAPEL_OPCIONES.map((o) => o.value)).toEqual(["A4", "A5", "A6"])
    for (const o of ORDEN_PAPEL_OPCIONES) {
      expect(ORDEN_PAGE_POINTS[o.value]).toBeDefined()
      expect(o.label).toContain(o.value)
    }
  })
})
