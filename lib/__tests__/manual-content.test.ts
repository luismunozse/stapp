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

  it('emitir una nota de crédito explica los dos modos, el reparto, la caja y el ticket del POS', () => {
    const s = manualSections.find((x) => x.id === 'notas-credito')!
    const b = s.content.find((x) => x.subtitle === 'Emitir una nota de crédito')!
    const texto = [b.body, ...(b.steps ?? []), b.tip ?? ''].join(' ')
    expect(texto).toContain('tocá "Nota de crédito"')
    expect(texto).toContain('"Por monto"')
    expect(texto).toMatch(/baja la deuda/i)
    expect(texto).toMatch(/no entra en ningún arqueo/)
    expect(texto).toMatch(/ticket de la nota de crédito/)
    expect(texto).not.toContain('abrí la venta y tocá "Devolución"')
    expect(b.roles).toEqual(['ADMIN'])
  })

  it('anular una venta ya no se presenta como la forma de hacer una devolución', () => {
    const ventas = manualSections.find((x) => x.id === 'ventas')!
    const anulacion = ventas.content.find((b) => b.subtitle === 'Anulación de ventas')!
    expect(anulacion.body).not.toMatch(/procesar devoluciones/)
    expect(anulacion.seeAlso).toContain('notas-credito')
  })

  it('anular una nota de crédito: solo el ADMIN, de la última a la primera, qué se revierte y cuándo no se puede', () => {
    const s = manualSections.find((x) => x.id === 'notas-credito')!
    const b = s.content.find((x) => x.subtitle === 'Anular una nota de crédito')!
    const texto = [b.body, ...(b.steps ?? []), b.tip ?? ''].join(' ')
    expect(b.roles).toEqual(['ADMIN'])
    expect(texto).toContain('de la última a la primera')
    expect(texto).toContain('sello ANULADA')
    expect(texto).toMatch(/vuelve a entrar a la caja/i)
    expect(texto).toMatch(/recuperala por fuera/)
    expect(texto).toMatch(/DEV-/)
    expect(texto).not.toMatch(/LIFO|RPC|anulada = false/)
  })
})
