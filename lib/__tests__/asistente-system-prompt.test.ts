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
    const dynamicValueRegex = /\$\s?\d/
    const staticAmounts = /\$10\.000/
    const hasDynamicValues = dynamicValueRegex.test(prompt) && !staticAmounts.test(prompt)
    expect(hasDynamicValues).toBe(false)
  })
})
