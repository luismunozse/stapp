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
})
