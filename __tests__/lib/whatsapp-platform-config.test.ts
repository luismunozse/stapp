import { describe, it, expect, afterEach, vi } from "vitest"
import { getPlatformEvolutionConfig, buildInstanceName } from "@/lib/whatsapp/platform-config"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("getPlatformEvolutionConfig", () => {
  it("returns baseUrl + apiKey from env (trimming trailing slash)", () => {
    vi.stubEnv("EVOLUTION_BASE_URL", "https://evo.stapp.com.ar/")
    vi.stubEnv("EVOLUTION_API_KEY", "secret-key")
    expect(getPlatformEvolutionConfig()).toEqual({
      baseUrl: "https://evo.stapp.com.ar",
      apiKey: "secret-key",
    })
  })

  it("returns null when baseUrl is missing", () => {
    vi.stubEnv("EVOLUTION_BASE_URL", "")
    vi.stubEnv("EVOLUTION_API_KEY", "secret-key")
    expect(getPlatformEvolutionConfig()).toBeNull()
  })

  it("returns null when apiKey is missing", () => {
    vi.stubEnv("EVOLUTION_BASE_URL", "https://evo.stapp.com.ar")
    vi.stubEnv("EVOLUTION_API_KEY", "")
    expect(getPlatformEvolutionConfig()).toBeNull()
  })
})

describe("buildInstanceName", () => {
  it("derives a stable per-org instance name", () => {
    expect(buildInstanceName("org-123")).toBe("stapp-org-org-123")
  })
})
