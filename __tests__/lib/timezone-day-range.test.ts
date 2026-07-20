// @vitest-environment node
import { describe, it, expect } from "vitest"
import { dayRangeUtc, todayInTimeZone } from "@/lib/timezone"

const ART = "America/Argentina/Buenos_Aires" // UTC-3

describe("dayRangeUtc — límites del día de la org como instantes UTC", () => {
  it("el día ART va de 03:00Z a 03:00Z del día siguiente (menos 1ms)", () => {
    const { desde, hasta } = dayRangeUtc("2026-07-20", ART)
    expect(desde).toBe("2026-07-20T03:00:00.000Z")
    expect(hasta).toBe("2026-07-21T02:59:59.999Z")
  })

  it("una venta a las 22:00 ART del 20 (01:00Z del 21) cae DENTRO del día 20", () => {
    const { desde, hasta } = dayRangeUtc("2026-07-20", ART)
    const venta = "2026-07-21T01:00:00.000Z" // 22:00 ART del 20
    expect(venta >= desde && venta <= hasta).toBe(true)
  })

  it("esa misma venta NO cae en el día 21", () => {
    const { desde } = dayRangeUtc("2026-07-21", ART)
    const venta = "2026-07-21T01:00:00.000Z"
    expect(venta >= desde).toBe(false)
  })
})

describe("todayInTimeZone — hoy en la tz de la org (no en UTC)", () => {
  it("a las 22:00 ART (01:00Z del día siguiente) sigue siendo el día local, no el UTC", () => {
    const now = new Date("2026-07-21T01:00:00Z") // 22:00 ART del 20
    expect(todayInTimeZone(ART, now)).toBe("2026-07-20")
  })

  it("al mediodía coincide", () => {
    const now = new Date("2026-07-20T12:00:00Z") // 09:00 ART
    expect(todayInTimeZone(ART, now)).toBe("2026-07-20")
  })
})
