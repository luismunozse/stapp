import { describe, it, expect } from "vitest"
import {
  dateRangeUtc,
  monthKeyInTimeZone,
  zonaHorariaValida,
  DEFAULT_TIMEZONE,
} from "@/lib/timezone"

const AR = "America/Argentina/Buenos_Aires" // UTC-3 todo el año
const MX = "America/Mexico_City"
const ES = "Europe/Madrid"

describe("dateRangeUtc", () => {
  it("el mes de un taller argentino arranca a las 03:00 UTC, no a las 00:00", () => {
    // El bug original: `new Date("2026-09-01T00:00:00")` sin offset lo resolvía
    // el server (UTC), así que septiembre arrancaba el 31/08 a las 21:00 locales.
    expect(dateRangeUtc("2026-09-01", "2026-09-30", AR)).toEqual({
      desde: "2026-09-01T03:00:00.000Z",
      hasta: "2026-10-01T02:59:59.999Z",
    })
  })

  it("una venta del último día del mes a las 22:00 locales cae DENTRO del mes", () => {
    const { desde, hasta } = dateRangeUtc("2026-09-01", "2026-09-30", AR)!
    // 30/09 22:00 en Argentina = 01/10 01:00 UTC
    const venta = "2026-10-01T01:00:00.000Z"

    expect(venta >= desde).toBe(true)
    expect(venta <= hasta).toBe(true)
  })

  it("una venta de la noche anterior al mes queda AFUERA", () => {
    const { desde } = dateRangeUtc("2026-09-01", "2026-09-30", AR)!
    // 31/08 22:00 en Argentina = 01/09 01:00 UTC — antes lo contaba como septiembre
    expect("2026-09-01T01:00:00.000Z" >= desde).toBe(false)
  })

  it("cada país usa su propio offset", () => {
    expect(dateRangeUtc("2026-05-01", "2026-05-31", MX)!.desde).toBe("2026-05-01T06:00:00.000Z")
    expect(dateRangeUtc("2026-05-01", "2026-05-31", ES)!.desde).toBe("2026-04-30T22:00:00.000Z")
  })

  it("un solo día es un rango válido", () => {
    expect(dateRangeUtc("2026-09-15", "2026-09-15", AR)).toEqual({
      desde: "2026-09-15T03:00:00.000Z",
      hasta: "2026-09-16T02:59:59.999Z",
    })
  })

  it("los rangos consecutivos no dejan huecos ni se pisan", () => {
    const septiembre = dateRangeUtc("2026-09-01", "2026-09-30", AR)!
    const octubre = dateRangeUtc("2026-10-01", "2026-10-31", AR)!
    // El fin de uno es 1 ms antes del inicio del otro: ningún cobro se pierde
    // ni se cuenta dos veces.
    expect(new Date(octubre.desde).getTime() - new Date(septiembre.hasta).getTime()).toBe(1)
  })

  it("cruza el cambio de hora de una tz con DST sin perder el día", () => {
    // Madrid pasa a horario de verano el 29/03/2026.
    const marzo = dateRangeUtc("2026-03-01", "2026-03-31", ES)!
    expect(marzo.desde).toBe("2026-02-28T23:00:00.000Z") // CET  (UTC+1)
    expect(marzo.hasta).toBe("2026-03-31T21:59:59.999Z") // CEST (UTC+2)
  })

  it("sin fechas, o con formato inválido, devuelve null para que decida el llamador", () => {
    expect(dateRangeUtc(null, null, AR)).toBeNull()
    expect(dateRangeUtc("2026-09-01", null, AR)).toBeNull()
    expect(dateRangeUtc("01/09/2026", "30/09/2026", AR)).toBeNull()
    expect(dateRangeUtc("2026-09-01T00:00:00Z", "2026-09-30", AR)).toBeNull()
  })
})

describe("monthKeyInTimeZone", () => {
  it("una venta del 30/09 a las 22:00 de Argentina es de septiembre, no de octubre", () => {
    // Con `new Date(iso).getMonth()` en un server UTC daba octubre: la
    // etiqueta del gráfico decía un mes y el contenido era de otro.
    expect(monthKeyInTimeZone("2026-10-01T01:00:00.000Z", AR)).toBe("2026-09")
  })

  it("el primer instante del mes local ya pertenece al mes nuevo", () => {
    expect(monthKeyInTimeZone("2026-09-01T03:00:00.000Z", AR)).toBe("2026-09")
    expect(monthKeyInTimeZone("2026-09-01T02:59:59.999Z", AR)).toBe("2026-08")
  })

  it("cruza el año correctamente", () => {
    // 01/01/2027 00:30 en Argentina = 03:30 UTC
    expect(monthKeyInTimeZone("2027-01-01T03:30:00.000Z", AR)).toBe("2027-01")
    // 31/12/2026 23:30 en Argentina = 02:30 UTC del 1/1
    expect(monthKeyInTimeZone("2027-01-01T02:30:00.000Z", AR)).toBe("2026-12")
  })

  it("el mes se completa con cero a la izquierda para poder ordenar como texto", () => {
    expect(monthKeyInTimeZone("2026-03-15T12:00:00.000Z", AR)).toBe("2026-03")
    expect(monthKeyInTimeZone("2026-03-15T12:00:00.000Z", AR) < "2026-10").toBe(true)
  })
})

describe("zonaHorariaValida", () => {
  it("deja pasar una zona horaria real", () => {
    expect(zonaHorariaValida(AR)).toBe(AR)
  })

  it("una zona horaria rota no tira: cae al default", () => {
    // Intl tira RangeError. Sin este guard, un solo dato malo en una fila
    // rompía el reporte entero.
    expect(zonaHorariaValida("No/Existe")).toBe(DEFAULT_TIMEZONE)
  })

  it("null, undefined y vacío caen al default", () => {
    expect(zonaHorariaValida(null)).toBe(DEFAULT_TIMEZONE)
    expect(zonaHorariaValida(undefined)).toBe(DEFAULT_TIMEZONE)
    expect(zonaHorariaValida("")).toBe(DEFAULT_TIMEZONE)
  })
})
