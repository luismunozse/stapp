import { describe, it, expect } from 'vitest'
import {
  extractSubdomain,
  isValidSlug,
  sanitizeSlug,
  RESERVED_SUBDOMAINS,
} from '../tenant'

describe('extractSubdomain', () => {
  it('extrae subdominio de URL completa', () => {
    expect(extractSubdomain('guru-tech.stapp.com.ar')).toBe('guru-tech')
    expect(extractSubdomain('mi-negocio.stapp.com.ar')).toBe('mi-negocio')
  })

  it('retorna null para dominio principal', () => {
    expect(extractSubdomain('stapp.com.ar')).toBe(null)
  })

  it('retorna null para www', () => {
    expect(extractSubdomain('www.stapp.com.ar')).toBe(null)
  })

  it('retorna null para localhost', () => {
    expect(extractSubdomain('localhost')).toBe(null)
  })

  it('retorna null para 127.0.0.1', () => {
    expect(extractSubdomain('127.0.0.1')).toBe(null)
  })

  it('maneja puerto en hostname', () => {
    expect(extractSubdomain('localhost:3000')).toBe(null)
    expect(extractSubdomain('127.0.0.1:3000')).toBe(null)
  })

  it('extrae subdominio ignorando puerto', () => {
    expect(extractSubdomain('demo.stapp.com.ar:443')).toBe('demo')
  })

  it('maneja subdominios con guiones', () => {
    expect(extractSubdomain('mi-empresa-tech.stapp.com.ar')).toBe('mi-empresa-tech')
  })

  it('maneja subdominios con numeros', () => {
    expect(extractSubdomain('empresa123.stapp.com.ar')).toBe('empresa123')
  })
})

describe('isValidSlug', () => {
  it('acepta slugs validos', () => {
    expect(isValidSlug('guru-tech').valid).toBe(true)
    expect(isValidSlug('miempresa').valid).toBe(true)
    expect(isValidSlug('tech123').valid).toBe(true)
    expect(isValidSlug('abc').valid).toBe(true)
  })

  it('rechaza slugs muy cortos', () => {
    expect(isValidSlug('ab').valid).toBe(false)
    expect(isValidSlug('ab').error).toContain('3 caracteres')
  })

  it('rechaza slugs de 1 caracter', () => {
    expect(isValidSlug('a').valid).toBe(false)
  })

  it('rechaza slugs muy largos', () => {
    const longSlug = 'a'.repeat(51)
    expect(isValidSlug(longSlug).valid).toBe(false)
    expect(isValidSlug(longSlug).error).toContain('50 caracteres')
  })

  it('acepta slug de exactamente 50 caracteres', () => {
    const slug = 'a'.repeat(50)
    expect(isValidSlug(slug).valid).toBe(true)
  })

  it('rechaza slugs que no empiezan con letra', () => {
    expect(isValidSlug('123abc').valid).toBe(false)
    expect(isValidSlug('-abc').valid).toBe(false)
    expect(isValidSlug('1empresa').valid).toBe(false)
  })

  it('rechaza caracteres especiales', () => {
    expect(isValidSlug('mi_empresa').valid).toBe(false)
    expect(isValidSlug('mi.empresa').valid).toBe(false)
    expect(isValidSlug('mi empresa').valid).toBe(false)
    expect(isValidSlug('mi@empresa').valid).toBe(false)
  })

  it('rechaza guiones consecutivos', () => {
    expect(isValidSlug('mi--empresa').valid).toBe(false)
  })

  it('rechaza slugs que terminan en guion', () => {
    expect(isValidSlug('empresa-').valid).toBe(false)
  })

  it('rechaza subdominios reservados', () => {
    expect(isValidSlug('www').valid).toBe(false)
    expect(isValidSlug('api').valid).toBe(false)
    expect(isValidSlug('admin').valid).toBe(false)
    expect(isValidSlug('app').valid).toBe(false)
    expect(isValidSlug('login').valid).toBe(false)
  })

  it('rechaza mayusculas', () => {
    expect(isValidSlug('MiEmpresa').valid).toBe(false)
    expect(isValidSlug('EMPRESA').valid).toBe(false)
  })
})

describe('sanitizeSlug', () => {
  it('convierte a minusculas', () => {
    expect(sanitizeSlug('MiEmpresa')).toBe('miempresa')
    expect(sanitizeSlug('EMPRESA')).toBe('empresa')
  })

  it('remueve acentos', () => {
    expect(sanitizeSlug('Reparación')).toBe('reparacion')
    expect(sanitizeSlug('técnico')).toBe('tecnico')
    expect(sanitizeSlug('José')).toBe('jose')
  })

  it('reemplaza espacios con guiones', () => {
    expect(sanitizeSlug('Mi Empresa')).toBe('mi-empresa')
    expect(sanitizeSlug('servicio tecnico')).toBe('servicio-tecnico')
  })

  it('reemplaza caracteres invalidos con guiones', () => {
    expect(sanitizeSlug('Mi_Empresa')).toBe('mi-empresa')
    expect(sanitizeSlug('mi@empresa')).toBe('mi-empresa')
    expect(sanitizeSlug('mi.empresa')).toBe('mi-empresa')
  })

  it('colapsa guiones multiples', () => {
    expect(sanitizeSlug('mi--empresa')).toBe('mi-empresa')
    expect(sanitizeSlug('mi   empresa')).toBe('mi-empresa')
    expect(sanitizeSlug('mi___empresa')).toBe('mi-empresa')
  })

  it('remueve guiones al inicio y final', () => {
    expect(sanitizeSlug('-empresa-')).toBe('empresa')
    expect(sanitizeSlug('---empresa---')).toBe('empresa')
  })

  it('trunca a 50 caracteres', () => {
    const longInput = 'a'.repeat(60)
    expect(sanitizeSlug(longInput).length).toBe(50)
  })

  it('maneja string vacio', () => {
    expect(sanitizeSlug('')).toBe('')
  })

  it('maneja solo caracteres especiales', () => {
    expect(sanitizeSlug('---')).toBe('')
    expect(sanitizeSlug('___')).toBe('')
  })
})

describe('RESERVED_SUBDOMAINS', () => {
  it('es un Set', () => {
    expect(RESERVED_SUBDOMAINS).toBeInstanceOf(Set)
  })

  it('contiene subdominios criticos', () => {
    expect(RESERVED_SUBDOMAINS.has('www')).toBe(true)
    expect(RESERVED_SUBDOMAINS.has('api')).toBe(true)
    expect(RESERVED_SUBDOMAINS.has('admin')).toBe(true)
    expect(RESERVED_SUBDOMAINS.has('app')).toBe(true)
    expect(RESERVED_SUBDOMAINS.has('login')).toBe(true)
    expect(RESERVED_SUBDOMAINS.has('registro')).toBe(true)
  })

  it('contiene subdominios de infraestructura', () => {
    expect(RESERVED_SUBDOMAINS.has('mail')).toBe(true)
    expect(RESERVED_SUBDOMAINS.has('cdn')).toBe(true)
    expect(RESERVED_SUBDOMAINS.has('static')).toBe(true)
    expect(RESERVED_SUBDOMAINS.has('assets')).toBe(true)
  })

  it('contiene subdominios de desarrollo', () => {
    expect(RESERVED_SUBDOMAINS.has('dev')).toBe(true)
    expect(RESERVED_SUBDOMAINS.has('staging')).toBe(true)
    expect(RESERVED_SUBDOMAINS.has('test')).toBe(true)
  })

  it('no contiene subdominios de usuario validos', () => {
    expect(RESERVED_SUBDOMAINS.has('miempresa')).toBe(false)
    expect(RESERVED_SUBDOMAINS.has('guru-tech')).toBe(false)
  })
})
