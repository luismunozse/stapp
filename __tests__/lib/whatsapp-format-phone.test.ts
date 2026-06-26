import { describe, it, expect } from "vitest"
import { formatPhoneNumber } from "@/lib/whatsapp/providers/evolution"

describe("formatPhoneNumber — multi-país", () => {
  it("Costa Rica: número local se prefija con 506, no con 54", () => {
    expect(formatPhoneNumber("8888-7777", "CR")).toBe("50688887777")
  })

  it("Costa Rica: número con código de país se respeta tal cual", () => {
    expect(formatPhoneNumber("+506 8888 7777", "CR")).toBe("50688887777")
  })

  it("Costa Rica: NO antepone 54 a un número que ya tiene 506", () => {
    expect(formatPhoneNumber("50688887777", "CR")).not.toMatch(/^54/)
  })

  it("Argentina explícita: número local se prefija con 54", () => {
    expect(formatPhoneNumber("11 1234-5678", "AR")).toBe("541112345678")
  })

  it("Fallback sin país: mantiene comportamiento Argentina", () => {
    expect(formatPhoneNumber("11 1234-5678")).toBe("541112345678")
  })
})
