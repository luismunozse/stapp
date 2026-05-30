import { describe, it, expect } from 'vitest'
import { addDaysInTimeZone, formatDateValue } from '../timezone'

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
