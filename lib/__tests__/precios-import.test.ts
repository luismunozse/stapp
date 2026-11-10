// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { parsePrice } from '../precios-import'

describe('parsePrice (shares the import number parser)', () => {
  it.each([
    ['1.500', 1500],
    ['$1.234,56', 1234.56],
    ['1,234.56', 1234.56],
    ['1234,5', 1234.5],
    ['$ 1234', 1234],
    [1500.456, 1500.46],
  ])('%j -> %j', (input, expected) => {
    expect(parsePrice(input as string | number)).toBe(expected)
  })

  it.each([['1.5.0'], ['12abc34'], ['-5'], [-5], [''], [null]])('%j -> null', (input) => {
    expect(parsePrice(input as string | number | null)).toBeNull()
  })
})
