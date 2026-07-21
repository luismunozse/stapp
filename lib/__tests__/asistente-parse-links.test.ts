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

  it('NO renderiza como link una ruta interna inexistente (alucinada)', () => {
    const segs = parseAsistenteLinks('Andá a [Pagos](/pagos-magicos) ya')
    expect(segs.every((s) => s.type === 'text')).toBe(true)
  })

  it('NO renderiza como link una ruta con traversal', () => {
    const segs = parseAsistenteLinks('Mirá [esto](/../evil) por favor')
    expect(segs.every((s) => s.type === 'text')).toBe(true)
  })

  it('parsea negrita como segmento bold', () => {
    expect(parseAsistenteLinks('Andá a **Tipos de Dispositivo** y creá uno')).toEqual([
      { type: 'text', text: 'Andá a ' },
      { type: 'bold', text: 'Tipos de Dispositivo' },
      { type: 'text', text: ' y creá uno' },
    ])
  })

  it('parsea negrita y link en el mismo mensaje', () => {
    const segs = parseAsistenteLinks('Abrí **Caja** desde [Caja](/caja)')
    expect(segs).toEqual([
      { type: 'text', text: 'Abrí ' },
      { type: 'bold', text: 'Caja' },
      { type: 'text', text: ' desde ' },
      { type: 'link', label: 'Caja', href: '/caja' },
    ])
  })

  it('limpia los ** dentro del label de un link', () => {
    const segs = parseAsistenteLinks('[**Órdenes**](/ordenes)')
    expect(segs).toEqual([{ type: 'link', label: 'Órdenes', href: '/ordenes' }])
  })

  it('asteriscos sueltos o sin cerrar quedan como texto plano', () => {
    expect(parseAsistenteLinks('2 * 3 = 6 y **sin cerrar')).toEqual([
      { type: 'text', text: '2 * 3 = 6 y **sin cerrar' },
    ])
  })

  it('quita la negrita que envuelve un link (patrón **[X](/ruta)**)', () => {
    expect(parseAsistenteLinks('Andá a **[Caja](/caja)** ahora')).toEqual([
      { type: 'text', text: 'Andá a ' },
      { type: 'link', label: 'Caja', href: '/caja' },
      { type: 'text', text: ' ahora' },
    ])
  })
})
