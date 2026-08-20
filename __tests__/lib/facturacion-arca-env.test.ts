import { describe, it, expect, afterEach, vi } from "vitest"
import { isArcaProduction, ArcaConfigError } from "@/lib/facturacion/arca/env"

describe("isArcaProduction", () => {
  afterEach(() => vi.unstubAllEnvs())

  it("returns true when ARCA_ENV=produccion", () => {
    vi.stubEnv("ARCA_ENV", "produccion")
    expect(isArcaProduction()).toBe(true)
  })

  it("returns false when ARCA_ENV=homologacion", () => {
    vi.stubEnv("ARCA_ENV", "homologacion")
    expect(isArcaProduction()).toBe(false)
  })

  it("returns false when ARCA_ENV is unset and NODE_ENV is not production", () => {
    vi.stubEnv("ARCA_ENV", undefined)
    vi.stubEnv("NODE_ENV", "test")
    expect(isArcaProduction()).toBe(false)
  })

  it("throws (fails closed) when ARCA_ENV is unset in a production NODE_ENV", () => {
    vi.stubEnv("ARCA_ENV", undefined)
    vi.stubEnv("NODE_ENV", "production")
    expect(() => isArcaProduction()).toThrow(ArcaConfigError)
  })

  it("throws on an unrecognized ARCA_ENV value rather than silently defaulting", () => {
    vi.stubEnv("ARCA_ENV", "staging")
    vi.stubEnv("NODE_ENV", "production")
    expect(() => isArcaProduction()).toThrow(ArcaConfigError)
  })
})
