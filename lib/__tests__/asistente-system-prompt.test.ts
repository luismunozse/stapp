import { describe, it, expect } from 'vitest'
import { buildAsistenteSystemPrompt } from '@/lib/asistente/system-prompt'
import { manualSections } from '@/lib/manual-content'

describe('buildAsistenteSystemPrompt', () => {
  it('es determinístico (mismo output byte a byte — requisito de prompt caching)', () => {
    expect(buildAsistenteSystemPrompt()).toBe(buildAsistenteSystemPrompt())
  })

  it('incluye todas las secciones del manual', () => {
    const prompt = buildAsistenteSystemPrompt()
    for (const s of manualSections) {
      expect(prompt).toContain(`## ${s.title}`)
    }
  })

  it('supera el mínimo cacheable de Haiku 4.5 (~4096 tokens ≈ 16k chars)', () => {
    expect(buildAsistenteSystemPrompt().length).toBeGreaterThan(20000)
  })

  it('no contiene valores dinámicos', () => {
    const prompt = buildAsistenteSystemPrompt()
    const year = new Date().getFullYear().toString()
    expect(prompt).not.toContain(year)
    // Permitir amounts estáticos como "$10.000" (fondo fijo de caja)
    const withoutKnownStatic = prompt.replace(/\$10\.000/g, '')
    expect(withoutKnownStatic).not.toMatch(/\$\s?\d/)
  })

  it('incluye las rutas del panel', () => {
    const prompt = buildAsistenteSystemPrompt()
    expect(prompt).toContain('# Rutas del panel')
    expect(prompt).toContain('/configuracion/whatsapp')
    expect(prompt).toContain('[Nombre de la pantalla](/ruta)')
  })

  it('declara el formato permitido de respuesta', () => {
    expect(buildAsistenteSystemPrompt()).toContain('Formato permitido')
  })
})
