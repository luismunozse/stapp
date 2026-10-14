import { describe, it, expect } from 'vitest'
import { manualSections } from '@/lib/manual-content'

describe('manualSections', () => {
  it('tiene todas las secciones del manual con ids únicos', () => {
    expect(manualSections.length).toBeGreaterThanOrEqual(20)
    const ids = manualSections.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('cada sección tiene título, roles y contenido no vacío', () => {
    for (const s of manualSections) {
      expect(s.title.length).toBeGreaterThan(0)
      expect(s.roles.length).toBeGreaterThan(0)
      expect(s.content.length).toBeGreaterThan(0)
      for (const block of s.content) {
        expect(block.subtitle.length).toBeGreaterThan(0)
        expect(block.body.length).toBeGreaterThan(0)
      }
    }
  })

  it('es data pura serializable (sin componentes React)', () => {
    expect(() => JSON.stringify(manualSections)).not.toThrow()
  })

  it('el bloque de imprimir o enviar una NC dice quién cambia el mensaje y qué pasa en la compu', () => {
    const s = manualSections.find((x) => x.id === 'notas-credito')!
    const b = s.content.find((x) => x.subtitle === 'Imprimir o enviar una nota de crédito')!
    expect(b.body).toMatch(/administrador/i)
    expect(b.body).toContain('menú de compartir del sistema')
    expect(b.body).not.toContain('que podés cambiar')
  })

  it('tiene la sección de notas de crédito para los tres roles, con el bloque del listado solo para el ADMIN', () => {
    const s = manualSections.find((x) => x.id === 'notas-credito')
    expect(s).toBeDefined()
    expect(s!.roles).toEqual(['ADMIN', 'TECNICO', 'VENDEDOR'])
    const texto = JSON.stringify(s)
    expect(texto).toContain('NC-')
    expect(texto).toContain('DEV-')
    expect(texto).toContain('/notas-credito')
    expect(texto).toMatch(/no reemplaza una factura/i)
    const listado = s!.content.find((b) => b.subtitle === 'Encontrar una nota de crédito')
    expect(listado?.roles).toEqual(['ADMIN'])
  })

  it('las referencias cruzadas de la sección apuntan a secciones que existen', () => {
    const ids = new Set(manualSections.map((x) => x.id))
    const s = manualSections.find((x) => x.id === 'notas-credito')!
    for (const b of s.content) for (const ref of b.seeAlso ?? []) expect(ids.has(ref), ref).toBe(true)
  })

  it('anular una venta ya no se presenta como la forma de hacer una devolución', () => {
    const ventas = manualSections.find((x) => x.id === 'ventas')!
    const anulacion = ventas.content.find((b) => b.subtitle === 'Anulación de ventas')!
    expect(anulacion.body).not.toMatch(/procesar devoluciones/)
    expect(anulacion.seeAlso).toContain('notas-credito')
  })
})
