import { describe, it, expect } from "vitest"
import { formatDivisa } from "@/lib/currency/formato-divisa"

describe("formatDivisa", () => {
  it("símbolo de la divisa y dígitos es-AR, sin decimales si es entero", () => {
    expect(formatDivisa(10, "USD")).toBe("US$ 10")
    expect(formatDivisa(1234.5, "USD")).toBe("US$ 1.234,50")
    expect(formatDivisa(12.5, "EUR")).toBe("€ 12,50")
  })
})
