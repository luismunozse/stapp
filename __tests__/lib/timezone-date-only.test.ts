// @vitest-environment node
import { describe, it, expect } from "vitest"
import { formatDateValue } from "@/lib/timezone"

const ART = "America/Argentina/Buenos_Aires"

describe("formatDateValue — columnas DATE (YYYY-MM-DD) no se corren un día", () => {
  it("una fecha date-only se muestra el mismo día en UTC-3", () => {
    // new Date('2026-07-20') = medianoche UTC → en UTC-3 cae 19/07 (el bug).
    expect(formatDateValue("2026-07-20", ART)).toBe("20/07/2026")
  })

  it("el primer día del mes no cae al mes anterior", () => {
    expect(formatDateValue("2026-08-01", ART)).toBe("01/08/2026")
  })

  it("funciona también en tz con offset positivo (Madrid UTC+1)", () => {
    expect(formatDateValue("2026-07-20", "Europe/Madrid")).toBe("20/07/2026")
  })

  it("funciona en tz con offset negativo grande (Los Angeles UTC-8)", () => {
    expect(formatDateValue("2026-07-20", "America/Los_Angeles")).toBe("20/07/2026")
  })

  it("sigue formateando timestamps completos según la tz (no los ancla)", () => {
    // 2026-07-20T01:00:00Z = 2026-07-19 22:00 ART → debe seguir dando 19/07.
    expect(formatDateValue("2026-07-20T01:00:00Z", ART)).toBe("19/07/2026")
  })

  it("vacío / inválido → ''", () => {
    expect(formatDateValue("", ART)).toBe("")
    expect(formatDateValue(null, ART)).toBe("")
    expect(formatDateValue("no-es-fecha", ART)).toBe("")
  })
})
