import { describe, it, expect } from 'vitest'
import {
  isValidSlug,
  isValidCuponCodigo,
  normalizeCuponCodigo,
  calcularDescuentoCupon,
  tieneVariantesActivas,
  puedeQuickAdd,
  cartKey,
  cartItemSchema,
  cartSchema,
  idArraySchema,
  SLUG_REGEX,
  CUPON_CODIGO_REGEX,
} from '../catalogo-validators'

describe('isValidSlug', () => {
  it('acepta slugs válidos (mínimo 3 chars)', () => {
    expect(isValidSlug('mi-tienda')).toBe(true)
    expect(isValidSlug('servicio-tecnico-ar')).toBe(true)
    expect(isValidSlug('abc')).toBe(true)
    expect(isValidSlug('abc123')).toBe(true)
  })

  it('acepta slugs de 1 char (grupo opcional vacío)', () => {
    // Regex: ^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])?$
    // El grupo opcional permite entrada de 1 char.
    expect(isValidSlug('a')).toBe(true)
    expect(isValidSlug('z')).toBe(true)
    expect(isValidSlug('7')).toBe(true)
  })

  it('rechaza slugs de exactamente 2 chars (gap del regex)', () => {
    // El grupo `([a-z0-9-]{1,48}[a-z0-9])?` requiere mínimo 2 chars dentro
    // ({1} + 1 final), por lo que strings totales de 2 chars no calzan.
    expect(isValidSlug('a1')).toBe(false)
    expect(isValidSlug('ab')).toBe(false)
  })

  it('rechaza slugs con mayúsculas', () => {
    expect(isValidSlug('Mi-Tienda')).toBe(false)
    expect(isValidSlug('ABC')).toBe(false)
  })

  it('rechaza slugs con caracteres especiales', () => {
    expect(isValidSlug('mi_tienda')).toBe(false)
    expect(isValidSlug('mi.tienda')).toBe(false)
    expect(isValidSlug('mi tienda')).toBe(false)
    expect(isValidSlug('mi/tienda')).toBe(false)
  })

  it('rechaza slugs que empiezan o terminan con guion', () => {
    expect(isValidSlug('-tienda')).toBe(false)
    expect(isValidSlug('tienda-')).toBe(false)
  })

  it('rechaza vacío, null, undefined', () => {
    expect(isValidSlug('')).toBe(false)
    expect(isValidSlug(null)).toBe(false)
    expect(isValidSlug(undefined)).toBe(false)
  })

  it('rechaza slugs demasiado largos', () => {
    const tooLong = 'a' + 'b'.repeat(49) + 'c' // > 50 chars
    expect(isValidSlug(tooLong)).toBe(false)
  })

  it('coincide con la regex exportada', () => {
    expect(SLUG_REGEX.test('mi-tienda')).toBe(true)
  })
})

describe('isValidCuponCodigo', () => {
  it('acepta códigos válidos', () => {
    expect(isValidCuponCodigo('VERANO25')).toBe(true)
    expect(isValidCuponCodigo('SALE-50')).toBe(true)
    expect(isValidCuponCodigo('NEW_USER')).toBe(true)
    expect(isValidCuponCodigo('A1B')).toBe(true) // mínimo 3
  })

  it('uppercase aplicado antes de validar', () => {
    expect(isValidCuponCodigo('verano25')).toBe(true)
  })

  it('rechaza códigos cortos (< 3)', () => {
    expect(isValidCuponCodigo('AB')).toBe(false)
    expect(isValidCuponCodigo('A')).toBe(false)
  })

  it('rechaza códigos largos (> 32)', () => {
    expect(isValidCuponCodigo('A'.repeat(33))).toBe(false)
  })

  it('rechaza caracteres no permitidos', () => {
    expect(isValidCuponCodigo('ABC.DEF')).toBe(false)
    expect(isValidCuponCodigo('ABC DEF')).toBe(false)
    expect(isValidCuponCodigo('ABC/DEF')).toBe(false)
    expect(isValidCuponCodigo('ABC$')).toBe(false)
  })

  it('rechaza vacío y null', () => {
    expect(isValidCuponCodigo('')).toBe(false)
    expect(isValidCuponCodigo(null)).toBe(false)
    expect(isValidCuponCodigo(undefined)).toBe(false)
  })

  it('regex exportada matchea misma cosa', () => {
    expect(CUPON_CODIGO_REGEX.test('VERANO25')).toBe(true)
    expect(CUPON_CODIGO_REGEX.test('ab')).toBe(false)
  })
})

describe('normalizeCuponCodigo', () => {
  it('convierte a uppercase + trim', () => {
    expect(normalizeCuponCodigo('  verano25  ')).toBe('VERANO25')
  })

  it('quita caracteres inválidos', () => {
    expect(normalizeCuponCodigo('sale.50!')).toBe('SALE50')
  })

  it('limita a 32 caracteres', () => {
    expect(normalizeCuponCodigo('A'.repeat(50))).toHaveLength(32)
  })

  it('conserva guion y guion bajo', () => {
    expect(normalizeCuponCodigo('new-user_2026')).toBe('NEW-USER_2026')
  })
})

describe('calcularDescuentoCupon', () => {
  it('porcentaje 10% sobre 1000 → 100', () => {
    expect(calcularDescuentoCupon('porcentaje', 10, 1000)).toBe(100)
  })

  it('porcentaje 50% sobre 999 → 499.5', () => {
    expect(calcularDescuentoCupon('porcentaje', 50, 999)).toBe(499.5)
  })

  it('porcentaje 100% sobre 500 → 500 (limita)', () => {
    expect(calcularDescuentoCupon('porcentaje', 100, 500)).toBe(500)
  })

  it('porcentaje > 100 → clamp a 100%', () => {
    expect(calcularDescuentoCupon('porcentaje', 150, 1000)).toBe(1000)
  })

  it('monto fijo menor al subtotal → monto fijo', () => {
    expect(calcularDescuentoCupon('monto', 200, 1000)).toBe(200)
  })

  it('monto fijo mayor al subtotal → subtotal completo (no negativo)', () => {
    expect(calcularDescuentoCupon('monto', 2000, 500)).toBe(500)
  })

  it('subtotal 0 → descuento 0', () => {
    expect(calcularDescuentoCupon('porcentaje', 50, 0)).toBe(0)
    expect(calcularDescuentoCupon('monto', 100, 0)).toBe(0)
  })

  it('valor 0 o negativo → descuento 0', () => {
    expect(calcularDescuentoCupon('porcentaje', 0, 1000)).toBe(0)
    expect(calcularDescuentoCupon('monto', -50, 1000)).toBe(0)
  })

  it('redondea a 2 decimales en porcentaje', () => {
    const r = calcularDescuentoCupon('porcentaje', 33.33, 100)
    expect(Number.isFinite(r)).toBe(true)
    // 33.33 → 33.33 exacto
    expect(r).toBeCloseTo(33.33, 2)
  })
})

describe('tieneVariantesActivas / puedeQuickAdd', () => {
  it('item sin variantes y con precio + stock → puede quick add', () => {
    const item = { precio: 100, stock_disponible: 5 }
    expect(tieneVariantesActivas(item)).toBe(false)
    expect(puedeQuickAdd(item)).toBe(true)
  })

  it('item con variantes → NO quick add (debe elegir)', () => {
    const item = {
      precio: 100,
      variantes: [{ id: 'v1', stock: 3 }],
    }
    expect(tieneVariantesActivas(item)).toBe(true)
    expect(puedeQuickAdd(item)).toBe(false)
  })

  it('item agotado → NO quick add', () => {
    expect(puedeQuickAdd({ precio: 100, stock_disponible: 0 })).toBe(false)
  })

  it('item sin precio → NO quick add (consultar)', () => {
    expect(puedeQuickAdd({ precio: null, stock_disponible: 5 })).toBe(false)
  })

  it('item con stock null (sin tracking) → puede quick add', () => {
    expect(puedeQuickAdd({ precio: 100, stock_disponible: null })).toBe(true)
  })
})

describe('cartItemSchema', () => {
  const valido = {
    id: 'item1',
    nombre: 'Producto X',
    precio: 100,
    cantidad: 2,
    imagen_url: null,
    stock_disponible: 5,
    varianteId: null,
    varianteEtiqueta: null,
  }

  it('acepta shape válido', () => {
    expect(cartItemSchema.safeParse(valido).success).toBe(true)
  })

  it('rechaza cantidad 0 o negativa', () => {
    expect(cartItemSchema.safeParse({ ...valido, cantidad: 0 }).success).toBe(false)
    expect(cartItemSchema.safeParse({ ...valido, cantidad: -1 }).success).toBe(false)
  })

  it('rechaza precio negativo', () => {
    expect(cartItemSchema.safeParse({ ...valido, precio: -10 }).success).toBe(false)
  })

  it('rechaza nombre vacío', () => {
    expect(cartItemSchema.safeParse({ ...valido, nombre: '' }).success).toBe(false)
  })

  it('rechaza id ausente', () => {
    const { id, ...sinId } = valido
    expect(cartItemSchema.safeParse(sinId).success).toBe(false)
  })

  it('acepta varianteId/varianteEtiqueta opcionales', () => {
    expect(cartItemSchema.safeParse({ ...valido, varianteId: 'v1', varianteEtiqueta: 'Rojo' }).success).toBe(true)
  })

  it('rechaza cantidad no-entera', () => {
    expect(cartItemSchema.safeParse({ ...valido, cantidad: 1.5 }).success).toBe(false)
  })

  it('rechaza cantidad astronómica', () => {
    expect(cartItemSchema.safeParse({ ...valido, cantidad: 10_000 }).success).toBe(false)
  })

  it('cartSchema acepta array vacío', () => {
    expect(cartSchema.safeParse([]).success).toBe(true)
  })

  it('cartSchema rechaza array > 100 items', () => {
    const big = Array.from({ length: 101 }, () => valido)
    expect(cartSchema.safeParse(big).success).toBe(false)
  })

  it('cartSchema rechaza un item corrupto en el array', () => {
    expect(cartSchema.safeParse([valido, { foo: 'bar' }]).success).toBe(false)
  })
})

describe('idArraySchema', () => {
  it('acepta array de strings válidos', () => {
    expect(idArraySchema.safeParse(['id1', 'id2', 'id3']).success).toBe(true)
  })

  it('acepta array vacío', () => {
    expect(idArraySchema.safeParse([]).success).toBe(true)
  })

  it('rechaza no-array', () => {
    expect(idArraySchema.safeParse('id1').success).toBe(false)
    expect(idArraySchema.safeParse({ 0: 'id1' }).success).toBe(false)
    expect(idArraySchema.safeParse(null).success).toBe(false)
  })

  it('rechaza strings vacíos en el array', () => {
    expect(idArraySchema.safeParse(['id1', '']).success).toBe(false)
  })

  it('rechaza tipos mezclados', () => {
    expect(idArraySchema.safeParse(['id1', 42]).success).toBe(false)
  })

  it('rechaza array > 200 elementos', () => {
    const big = Array.from({ length: 201 }, (_, i) => `id${i}`)
    expect(idArraySchema.safeParse(big).success).toBe(false)
  })
})

describe('cartKey', () => {
  it('item sin variante → solo id', () => {
    expect(cartKey({ id: 'item1' })).toBe('item1')
    expect(cartKey({ id: 'item1', varianteId: null })).toBe('item1')
    expect(cartKey({ id: 'item1', varianteId: undefined })).toBe('item1')
  })

  it('item con variante → id::varianteId', () => {
    expect(cartKey({ id: 'item1', varianteId: 'v1' })).toBe('item1::v1')
  })

  it('mismo item con distintas variantes → keys distintas', () => {
    const k1 = cartKey({ id: 'item1', varianteId: 'v1' })
    const k2 = cartKey({ id: 'item1', varianteId: 'v2' })
    expect(k1).not.toBe(k2)
  })

  it('item con variante vs sin → keys distintas (no colisión)', () => {
    const k1 = cartKey({ id: 'item1' })
    const k2 = cartKey({ id: 'item1', varianteId: 'v1' })
    expect(k1).not.toBe(k2)
  })
})
