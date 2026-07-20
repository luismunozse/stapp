import { describe, it, expect } from 'vitest'
import { parseAsistenteLinks } from '@/lib/asistente/parse-links'

describe('parseAsistenteLinks', () => {
  it('texto sin links queda como un único segmento de texto', () => {
    expect(parseAsistenteLinks('Hola, ¿cómo estás?')).toEqual([
      { type: 'text', text: 'Hola, ¿cómo estás?' },
    ])
  })

  it('parsea un link interno con texto antes y después', () => {
    expect(
      parseAsistenteLinks('Andá a [Configuración → WhatsApp](/configuracion/whatsapp) y escaneá el QR.')
    ).toEqual([
      { type: 'text', text: 'Andá a ' },
      { type: 'link', label: 'Configuración → WhatsApp', href: '/configuracion/whatsapp' },
      { type: 'text', text: ' y escaneá el QR.' },
    ])
  })

  it('parsea múltiples links', () => {
    const segs = parseAsistenteLinks('Ver [Órdenes](/ordenes) o [Caja](/caja)')
    expect(segs.filter((s) => s.type === 'link')).toHaveLength(2)
  })

  it('NO renderiza como link una URL externa en formato markdown', () => {
    const segs = parseAsistenteLinks('Mirá [esto](https://evil.com) por favor')
    expect(segs.every((s) => s.type === 'text')).toBe(true)
  })

  it('NO renderiza como link una ruta protocol-relative (//)', () => {
    const segs = parseAsistenteLinks('Mirá [esto](//evil.com) por favor')
    expect(segs.every((s) => s.type === 'text')).toBe(true)
  })

  it('preserva saltos de línea en los segmentos de texto', () => {
    const segs = parseAsistenteLinks('Paso 1\nPaso 2 en [Caja](/caja)\nPaso 3')
    expect(segs[0]).toEqual({ type: 'text', text: 'Paso 1\nPaso 2 en ' })
    expect(segs[2]).toEqual({ type: 'text', text: '\nPaso 3' })
  })
})
