import { describe, it, expect, afterEach, vi } from "vitest"
import { getEvolutionCreds } from "@/lib/whatsapp/providers"

afterEach(() => vi.unstubAllEnvs())

const baseConfig = {
  provider: "evolution" as const,
  is_configured: true,
  phone_number_id: null,
  access_token_encrypted: null,
  evolution_base_url: null,
  evolution_instance_name: "stapp-org-org-1",
  evolution_api_key_encrypted: null,
}

describe("getEvolutionCreds (platform env)", () => {
  it("uses platform env for baseUrl/apiKey and DB instanceName", () => {
    vi.stubEnv("EVOLUTION_BASE_URL", "https://evo.stapp.com.ar")
    vi.stubEnv("EVOLUTION_API_KEY", "platform-key")
    expect(getEvolutionCreds(baseConfig)).toEqual({
      baseUrl: "https://evo.stapp.com.ar",
      instanceName: "stapp-org-org-1",
      apiKey: "platform-key",
    })
  })

  it("returns null when platform env is missing", () => {
    vi.stubEnv("EVOLUTION_BASE_URL", "")
    vi.stubEnv("EVOLUTION_API_KEY", "")
    expect(getEvolutionCreds(baseConfig)).toBeNull()
  })

  it("returns null when instanceName is missing", () => {
    vi.stubEnv("EVOLUTION_BASE_URL", "https://evo.stapp.com.ar")
    vi.stubEnv("EVOLUTION_API_KEY", "platform-key")
    expect(getEvolutionCreds({ ...baseConfig, evolution_instance_name: null })).toBeNull()
  })
})
