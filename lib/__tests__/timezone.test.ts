import { describe, it, expect } from 'vitest'
import { addDaysInTimeZone, formatDateValue, getZonedParts, zonedTimeToUtc } from '../timezone'

describe('addDaysInTimeZone', () => {
  it('cae en el día calendario "hoy + N" en la zona del taller, sin off-by-one', () => {
    // Creado a las 22:00 del 12/05 en UTC-3 = 01:00Z del 13/05.
    // El día calendario en UTC-3 es 12/05; +30 días debe ser 11/06,
    // no 10/06 (que es lo que ocurría con new Date()+setDate anclado a UTC).
    const from = new Date('2026-05-13T01:00:00Z')
    const iso = addDaysInTimeZone(30, 'America/Argentina/Buenos_Aires', from)
    expect(formatDateValue(iso, 'America/Argentina/Buenos_Aires')).toBe('11/06/2026')
  })

  it('mismo día calendario base en distintas zonas produce el mismo día destino', () => {
    const from = new Date('2026-01-15T12:00:00Z')
    const isoAr = addDaysInTimeZone(7, 'America/Argentina/Buenos_Aires', from)
    const isoMx = addDaysInTimeZone(7, 'America/Mexico_City', from)
    expect(formatDateValue(isoAr, 'America/Argentina/Buenos_Aires')).toBe('22/01/2026')
    expect(formatDateValue(isoMx, 'America/Mexico_City')).toBe('22/01/2026')
  })

  it('cruza el cambio de mes correctamente', () => {
    const from = new Date('2026-01-25T12:00:00Z')
    const iso = addDaysInTimeZone(10, 'America/Argentina/Buenos_Aires', from)
    expect(formatDateValue(iso, 'America/Argentina/Buenos_Aires')).toBe('04/02/2026')
  })

  it('el día calendario destino se mantiene al renderizar en zonas UTC-8..UTC+1', () => {
    const from = new Date('2026-03-10T12:00:00Z')
    const iso = addDaysInTimeZone(15, 'America/Los_Angeles', from)
    // mediodía UTC se renderiza al mismo día calendario en todo el rango soportado
    expect(formatDateValue(iso, 'America/Los_Angeles')).toBe('25/03/2026')
    expect(formatDateValue(iso, 'Europe/Madrid')).toBe('25/03/2026')
  })
})

describe('getZonedParts', () => {
  // Buenos Aires is UTC-3, no DST.
  it('noon UTC → 09:00 Buenos Aires, Thursday, day 15', () => {
    // 2026-01-15 Thursday 12:00 UTC → 09:00 BsAs
    const d = new Date('2026-01-15T12:00:00Z')
    const p = getZonedParts(d, 'America/Argentina/Buenos_Aires')
    expect(p.year).toBe(2026)
    expect(p.month).toBe(1)
    expect(p.day).toBe(15)
    expect(p.hour).toBe(9)
    expect(p.minute).toBe(0)
    expect(p.weekday).toBe(4) // 0=Sun, 4=Thu
  })

  it('turno 2026-06-10T23:30:00Z → 20:30 Buenos Aires same day (Wed)', () => {
    // UTC-3: 23:30 - 3h = 20:30, same day June 10
    const d = new Date('2026-06-10T23:30:00Z')
    const p = getZonedParts(d, 'America/Argentina/Buenos_Aires')
    expect(p.day).toBe(10)
    expect(p.hour).toBe(20)
    expect(p.minute).toBe(30)
    expect(p.month).toBe(6)
    expect(p.weekday).toBe(3) // Wednesday = 3
  })

  it('turno 2026-06-11T02:00:00Z → 23:00 June 10 in Buenos Aires (crosses midnight)', () => {
    // UTC-3: 2026-06-11 02:00Z = 2026-06-10 23:00 BsAs
    const d = new Date('2026-06-11T02:00:00Z')
    const p = getZonedParts(d, 'America/Argentina/Buenos_Aires')
    expect(p.day).toBe(10)
    expect(p.hour).toBe(23)
    expect(p.minute).toBe(0)
    expect(p.month).toBe(6)
    expect(p.weekday).toBe(3) // Wednesday June 10 = 3
  })

  it('works with a non-UTC-3 timezone (America/Mexico_City UTC-6)', () => {
    // 2026-01-15T12:00:00Z → Mexico City (UTC-6) = 06:00
    const d = new Date('2026-01-15T12:00:00Z')
    const p = getZonedParts(d, 'America/Mexico_City')
    expect(p.hour).toBe(6)
    expect(p.day).toBe(15)
    expect(p.weekday).toBe(4) // still Thursday
  })

  it('hour12=false "24" edge case: midnight is 0', () => {
    // 2026-06-10T03:00:00Z → Buenos Aires midnight (UTC-3)
    const d = new Date('2026-06-10T03:00:00Z')
    const p = getZonedParts(d, 'America/Argentina/Buenos_Aires')
    expect(p.hour).toBe(0)
    expect(p.day).toBe(10)
  })
})

describe('zonedTimeToUtc', () => {
  it('midnight BsAs → 03:00 UTC', () => {
    const utc = zonedTimeToUtc(2026, 1, 15, 0, 0, 0, 'America/Argentina/Buenos_Aires')
    expect(utc.toISOString()).toBe('2026-01-15T03:00:00.000Z')
  })

  it('round-trip: getZonedParts(zonedTimeToUtc(...)) returns original wall components', () => {
    const tz = 'America/Argentina/Buenos_Aires'
    const utc = zonedTimeToUtc(2026, 6, 10, 20, 30, 0, tz)
    const back = getZonedParts(utc, tz)
    expect(back.year).toBe(2026)
    expect(back.month).toBe(6)
    expect(back.day).toBe(10)
    expect(back.hour).toBe(20)
    expect(back.minute).toBe(30)
  })

  it('midnight Mexico City (UTC-6) → 06:00 UTC', () => {
    const utc = zonedTimeToUtc(2026, 1, 15, 0, 0, 0, 'America/Mexico_City')
    expect(utc.toISOString()).toBe('2026-01-15T06:00:00.000Z')
  })

  it('round-trip for Mexico City', () => {
    const tz = 'America/Mexico_City'
    const utc = zonedTimeToUtc(2026, 3, 8, 14, 30, 0, tz)
    const back = getZonedParts(utc, tz)
    expect(back.year).toBe(2026)
    expect(back.month).toBe(3)
    expect(back.day).toBe(8)
    expect(back.hour).toBe(14)
    expect(back.minute).toBe(30)
  })

  it('end-of-day BsAs 23:59:59 → UTC', () => {
    const utc = zonedTimeToUtc(2026, 6, 10, 23, 59, 59, 'America/Argentina/Buenos_Aires')
    // UTC-3 → +3h
    expect(utc.toISOString()).toBe('2026-06-11T02:59:59.000Z')
  })
})
