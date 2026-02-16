import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isSuperadminEmail } from '../superadmin-auth'

describe('isSuperadminEmail', () => {
  const originalEnv = process.env.SUPERADMIN_EMAILS

  beforeEach(() => {
    process.env.SUPERADMIN_EMAILS = 'admin@stapp.com, super@stapp.com, test@example.com'
  })

  afterEach(() => {
    process.env.SUPERADMIN_EMAILS = originalEnv
  })

  it('retorna true para email de superadmin', () => {
    expect(isSuperadminEmail('admin@stapp.com')).toBe(true)
    expect(isSuperadminEmail('super@stapp.com')).toBe(true)
    expect(isSuperadminEmail('test@example.com')).toBe(true)
  })

  it('retorna false para email no superadmin', () => {
    expect(isSuperadminEmail('usuario@gmail.com')).toBe(false)
    expect(isSuperadminEmail('random@test.com')).toBe(false)
  })

  it('retorna false para null', () => {
    expect(isSuperadminEmail(null)).toBe(false)
  })

  it('retorna false para undefined', () => {
    expect(isSuperadminEmail(undefined)).toBe(false)
  })

  it('retorna false para string vacío', () => {
    expect(isSuperadminEmail('')).toBe(false)
  })

  it('es case insensitive', () => {
    expect(isSuperadminEmail('ADMIN@STAPP.COM')).toBe(true)
    expect(isSuperadminEmail('Admin@Stapp.Com')).toBe(true)
    expect(isSuperadminEmail('SUPER@stapp.com')).toBe(true)
  })

  it('maneja espacios en la variable de entorno', () => {
    // La variable tiene espacios después de las comas
    expect(isSuperadminEmail('super@stapp.com')).toBe(true)
    expect(isSuperadminEmail('test@example.com')).toBe(true)
  })

  it('retorna false cuando SUPERADMIN_EMAILS no está definido', () => {
    delete process.env.SUPERADMIN_EMAILS
    expect(isSuperadminEmail('admin@stapp.com')).toBe(false)
  })

  it('retorna false cuando SUPERADMIN_EMAILS está vacío', () => {
    process.env.SUPERADMIN_EMAILS = ''
    expect(isSuperadminEmail('admin@stapp.com')).toBe(false)
  })

  it('funciona con un solo email en la variable', () => {
    process.env.SUPERADMIN_EMAILS = 'unico@stapp.com'
    expect(isSuperadminEmail('unico@stapp.com')).toBe(true)
    expect(isSuperadminEmail('otro@stapp.com')).toBe(false)
  })
})
