import { describe, it, expect } from 'vitest'
import { parseLocalizedNumber } from '../number-parse'

describe('parseLocalizedNumber', () => {
  it.each([
    // Argentine convention wins on ambiguity: a lone dot followed by 3 digits is a thousands separator.
    ['1.500', 1500],
    ['12.000', 12000],
    ['1.500,50', 1500.5],
    ['1.234.567', 1234567],
    ['1.234.567,89', 1234567.89],
    ['1500,50', 1500.5],
    ['1500.50', 1500.5],
    ['1,5', 1.5],
    // a lone comma is always the Argentine decimal separator
    ['1,234', 1.234],
    ['1,125', 1.125],
    ['12,500', 12.5],
    ['1 500', 1500],
    ['1 500 000', 1500000],
    ['0,5', 0.5],
    ['0.500', 0.5],
    ['12.5', 12.5],
    ['1234.567', 1234.567],
    // en-US style
    ['1,234.56', 1234.56],
    ['1,234,567.89', 1234567.89],
    ['1,234,567', 1234567],
    // plain
    ['1500', 1500],
    ['0', 0],
    ['-5', -5],
    ['-1.500,50', -1500.5],
    // currency / whitespace noise
    ['$ 1.500', 1500],
    ['$1.500,50', 1500.5],
    ['  1.500  ', 1500],
    ['1 500', 1500],
    ['ARS 1.500', 1500],
    ['1.500 ARS', 1500],
    ['USD 15,50', 15.5],
    ['U$S 15', 15],
    // native numbers pass through untouched
    [1500, 1500],
    [12.5, 12.5],
    [0, 0],
  ])('parses %j as %j', (input, expected) => {
    expect(parseLocalizedNumber(input as string | number)).toBe(expected)
  })

  it.each([
    ['abc'],
    ['1.5.0'],
    ['1,5,0'],
    ['1.50.000'],
    ['12abc34'],
    ['1e5'],
    ['--5'],
    ['1.2,3.4'],
    ['1,500.50.20'],
    ['10 USD 20'],
    ['5 ars 100'],
    ['1usd5'],
    ['12 34'],
    ['$'],
    ['.'],
    [','],
    [''],
    ['   '],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
  ])('rejects %j', (input) => {
    expect(parseLocalizedNumber(input as string | number)).toBeNull()
  })

  it('returns null for null and undefined', () => {
    expect(parseLocalizedNumber(null)).toBeNull()
    expect(parseLocalizedNumber(undefined)).toBeNull()
  })
})
