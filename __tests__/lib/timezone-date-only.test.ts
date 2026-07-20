// @vitest-environment node
import { describe, it, expect } from "vitest"
import { formatDateValue, dateOnlyToNoonUtcISO, dateNumberInTimeZone } from "@/lib/timezone"

const ART = "America/Argentina/Buenos_Aires"

describe("dateOnlyToNoonUtcISO — guarda la fecha de vencimiento anclada al mediodía UTC", () => {
  it("ancla un YYYY-MM-DD al mediodía UTC", () => {
    expect(dateOnlyToNoonUtcISO("2026-07-18")).toBe("2026-07-18T12:00:00.000Z")
  })

  it("un timestamp completo se preserva (se normaliza a ISO)", () => {
    expect(dateOnlyToNoonUtcISO("2026-07-18T15:30:00Z")).toBe("2026-07-18T15:30:00.000Z")
  })
})

describe("dateNumberInTimeZone — número de día calendario (YYYYMMDD) en una tz", () => {
  it("mediodía UTC representa el mismo día en UTC-3", () => {
    expect(dateNumberInTimeZone("2026-07-18T12:00:00Z", ART)).toBe(20260718)
  })

  it("medianoche UTC cae al día anterior en UTC-3 (el bug que evita el ancla)", () => {
    expect(dateNumberInTimeZone("2026-07-18T00:00:00Z", ART)).toBe(20260717)
  })

  it("expiry: una cotización que vence hoy NO está vencida dentro del día", () => {
    // vence 18/07 (guardada al mediodía UTC); 'ahora' = 18/07 15:00 ART
    const venc = dateNumberInTimeZone("2026-07-18T12:00:00Z", ART)
    const ahora = dateNumberInTimeZone("2026-07-18T18:00:00Z", ART) // 15:00 ART
    expect(ahora > venc).toBe(false) // mismo día → no vencida
  })

  it("expiry: vencida al día siguiente", () => {
    const venc = dateNumberInTimeZone("2026-07-18T12:00:00Z", ART)
    const ahora = dateNumberInTimeZone("2026-07-19T18:00:00Z", ART) // 15:00 ART del 19
    expect(ahora > venc).toBe(true)
  })
})

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
