// @vitest-environment node
import { describe, it, expect } from "vitest"
import { dayRangeUtc, todayInTimeZone, monthRangeUtc, addMonthsToDateOnly } from "@/lib/timezone"

const ART = "America/Argentina/Buenos_Aires" // UTC-3

describe("addMonthsToDateOnly — suma meses a un YYYY-MM-DD sin desfase de tz", () => {
  it("suma un mes dentro del año", () => {
    expect(addMonthsToDateOnly("2026-07-20", 1)).toBe("2026-08-20")
  })

  it("cruza el año", () => {
    expect(addMonthsToDateOnly("2026-12-20", 1)).toBe("2027-01-20")
  })

  it("varias cuotas mensuales desde la base", () => {
    expect(addMonthsToDateOnly("2026-07-20", 3)).toBe("2026-10-20")
  })

  it("mantiene el día (no se corre por UTC)", () => {
    // el 1ro no cae al mes anterior
    expect(addMonthsToDateOnly("2026-07-01", 1)).toBe("2026-08-01")
  })
})

describe("monthRangeUtc — límites del mes de la org como instantes UTC", () => {
  it("julio ART va de 2026-07-01 03:00Z a 2026-08-01 03:00Z (menos 1ms)", () => {
    const { desde, hasta } = monthRangeUtc(2026, 7, ART)
    expect(desde.toISOString()).toBe("2026-07-01T03:00:00.000Z")
    expect(hasta.toISOString()).toBe("2026-08-01T02:59:59.999Z")
  })

  it("una venta a las 22:00 ART del 31/07 (01:00Z del 01/08) cae DENTRO de julio", () => {
    const { desde, hasta } = monthRangeUtc(2026, 7, ART)
    const venta = new Date("2026-08-01T01:00:00.000Z") // 22:00 ART del 31/07
    expect(venta >= desde && venta <= hasta).toBe(true)
  })

  it("esa misma venta NO cae en agosto", () => {
    const { desde } = monthRangeUtc(2026, 8, ART)
    const venta = new Date("2026-08-01T01:00:00.000Z")
    expect(venta >= desde).toBe(false)
  })

  it("month 0 = diciembre del año anterior (mes previo de enero)", () => {
    const { desde } = monthRangeUtc(2026, 0, ART)
    // 1 dic 2025 00:00 ART = 2025-12-01T03:00:00Z
    expect(desde.toISOString()).toBe("2025-12-01T03:00:00.000Z")
  })
})

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
