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

  describe('variantes de producto (VF-9)', () => {
    const seccion = manualSections.find((s) => s.id === 'variantes')
    const texto = JSON.stringify(seccion?.content ?? [])

    it('existe una sección de variantes que apunta al inventario', () => {
      expect(seccion).toBeDefined()
      expect(seccion!.title).toBe('Variantes de producto')
      expect(texto).toContain('"inventario"')
    })

    it('explica la foto propia de cada variante y la foto prestada cuando una no tiene', () => {
      expect(texto).toMatch(/cada variante tiene su propia foto/i)
      expect(texto).toMatch(/foto de otra variante/i)
      expect(texto).toMatch(/atenuada|opaca/i)
    })

    it('explica crear, agrupar productos que ya existen, y desagrupar', () => {
      expect(texto).toMatch(/este producto tiene variantes/i)
      expect(texto).toMatch(/Agrupar productos existentes como variantes/)
      expect(texto).toMatch(/Renombrar productos/)
      expect(texto).toMatch(/desagrup/i)
    })

    it('explica el camino desde el formulario (el del celular): Sumar productos existentes', () => {
      expect(texto).toMatch(/Sumar productos existentes/)
      expect(texto).toMatch(/celular/i)
    })

    it('avisa que agrupar aplica el control de series y lotes del producto elegido a todos, y que el diálogo avisa', () => {
      expect(texto).toMatch(/control de series y de lotes/i)
      expect(texto).toMatch(/del producto que elijas/i)
      expect(texto).toMatch(/te avisa|te avisamos/i)
      expect(texto).toMatch(/Entiendo/)
      // Only series gate a sale: lots do not.
      expect(texto).toMatch(/empieza a pedir series al vender/i)
      expect(texto).not.toMatch(/pedirlas/)
      expect(texto).toMatch(/lotes y los avisos de vencimiento/i)
    })

    it('no mezcla jerga interna', () => {
      expect(texto).not.toMatch(/grupo_id|atributos|RPC|migraci/i)
    })
  })

  it('es data pura serializable (sin componentes React)', () => {
    expect(() => JSON.stringify(manualSections)).not.toThrow()
  })
})
