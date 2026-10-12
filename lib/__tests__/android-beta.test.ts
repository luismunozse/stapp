import { describe, it, expect } from 'vitest'
import { emailsParaPlay, inscripcionSchema, toInscripcion, PLAY_TESTING_URL } from '../android-beta'

describe('emailsParaPlay', () => {
  it('devuelve solo los PENDIENTE, en orden (la pantalla los une con coma para Play Console)', () => {
    const filas = [
      { email: 'a@gmail.com', estado: 'PENDIENTE' },
      { email: 'b@gmail.com', estado: 'AGREGADO' },
      { email: 'c@taller.com', estado: 'PENDIENTE' },
      { email: 'd@gmail.com', estado: 'DESCARTADO' },
    ]
    expect(emailsParaPlay(filas)).toEqual(['a@gmail.com', 'c@taller.com'])
  })

  it('no repite un correo que dos usuarios cargaron (Play rechaza duplicados y el conteo mentiría)', () => {
    const filas = [
      { email: 'a@gmail.com', estado: 'PENDIENTE' },
      { email: 'A@Gmail.com', estado: 'PENDIENTE' },
    ]
    expect(emailsParaPlay(filas)).toEqual(['a@gmail.com'])
  })

  it('sin pendientes devuelve vacío', () => {
    expect(emailsParaPlay([{ email: 'a@gmail.com', estado: 'AGREGADO' }])).toEqual([])
  })
})

describe('inscripcionSchema', () => {
  it('normaliza a minúsculas y sin espacios', () => {
    expect(inscripcionSchema.parse({ email: '  Ana@Gmail.COM ' }).email).toBe('ana@gmail.com')
  })

  it('rechaza lo que no es un correo', () => {
    expect(inscripcionSchema.safeParse({ email: 'ana' }).success).toBe(false)
    expect(inscripcionSchema.safeParse({ email: 'a'.repeat(250) + '@x.com' }).success).toBe(false)
  })
})

describe('toInscripcion', () => {
  it('el link de invitación aparece solo en AGREGADO', () => {
    expect(toInscripcion({ email: 'a@x.com', estado: 'PENDIENTE' })).not.toHaveProperty('linkInvitacion')
    expect(toInscripcion({ email: 'a@x.com', estado: 'DESCARTADO' })).not.toHaveProperty('linkInvitacion')
    expect(toInscripcion({ email: 'a@x.com', estado: 'AGREGADO' }).linkInvitacion).toBe(PLAY_TESTING_URL)
  })
})
