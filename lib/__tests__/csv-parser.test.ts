// @vitest-environment node
import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { parseCSV, parseExcel } from '../csv-parser'

const b64 = (text: string) => Buffer.from(text, 'utf-8').toString('base64')

describe('parseCSV — cells stay strings (no silent number coercion)', () => {
  it('keeps "1.500" as the string "1.500" (comma delimiter)', async () => {
    const r = await parseCSV(b64('nombre,stock,precioVenta\nFunda,3,1.500'))
    expect(r.errors).toEqual([])
    expect(r.data[0]).toEqual({ nombre: 'Funda', stock: '3', precioVenta: '1.500' })
  })

  it('keeps "1.500,50" and "12.000" untouched (semicolon delimiter)', async () => {
    const r = await parseCSV(b64('nombre;stock;precioVenta\nFunda;3;1.500,50\nVidrio;2;12.000'))
    expect(r.errors).toEqual([])
    expect(r.data.map((d) => d.precioVenta)).toEqual(['1.500,50', '12.000'])
  })

  it('keeps leading zeros of phone numbers and DNI', async () => {
    const r = await parseCSV(b64('nombre,telefono,dni\nJuan,0111234567,00123456'))
    expect(r.data[0]).toEqual({ nombre: 'Juan', telefono: '0111234567', dni: '00123456' })
  })
})

describe('parseCSV — structural problems are per-row, not file-level', () => {
  it('reports an unquoted decimal comma as a row error with the spreadsheet line number', async () => {
    const r = await parseCSV(b64('nombre,stock,precioVenta\nFunda,3,1500,50\nVidrio,2,800'))
    // nothing aborts the file
    expect(r.errors).toEqual([])
    expect(r.totalRows).toBe(2)
    expect(r.rowErrors).toHaveLength(1)
    expect(r.rowErrors[0].row).toBe(2) // header = line 1, first data row = line 2
    expect(r.rowErrors[0].message).toContain('más columnas')
    expect(r.rowErrors[0].message).toContain('punto y coma')
    expect(r.rowErrors[0].message).not.toMatch(/Too many fields|Row 0/)
    // the good row is still parsed
    expect(r.data[1]).toEqual({ nombre: 'Vidrio', stock: '2', precioVenta: '800' })
  })

  it('pads rows with fewer cells than the header instead of failing', async () => {
    const r = await parseCSV(b64('nombre,stock,precioVenta\nFunda,3'))
    expect(r.errors).toEqual([])
    expect(r.rowErrors).toEqual([])
    expect(r.data[0].nombre).toBe('Funda')
    expect(r.data[0].precioVenta ?? '').toBe('')
  })

  it('ignores trailing empty cells beyond the header', async () => {
    const r = await parseCSV(b64('nombre,stock\nFunda,3,,\n'))
    expect(r.rowErrors).toEqual([])
    expect(r.data[0]).toEqual({ nombre: 'Funda', stock: '3' })
  })
})

describe('parseCSV — row numbers match the spreadsheet', () => {
  it('counts blank lines (Excel shows them as rows)', async () => {
    const r = await parseCSV(b64('nombre,stock\nA,1\n\nB,2\n'))
    expect(r.data.map((d) => d.nombre)).toEqual(['A', 'B'])
    expect(r.rowNumbers).toEqual([2, 4])
  })

  it('counts a quoted multi-line cell as ONE row', async () => {
    const r = await parseCSV(b64('nombre,stock\n"Linea 1\nlinea 2",1\nB,2'))
    expect(r.rowNumbers).toEqual([2, 3])
  })

  it('skips fully empty rows made only of delimiters', async () => {
    const r = await parseCSV(b64('nombre,stock\n,\nB,2'))
    expect(r.data).toHaveLength(1)
    expect(r.rowNumbers).toEqual([3])
  })

  it('detects the delimiter on a short file with a trailing newline and a blank line', async () => {
    const r = await parseCSV(b64('nombre;stock\nA;1\n\nB;2\n'))
    expect(Object.keys(r.data[0])).toEqual(['nombre', 'stock'])
    expect(r.rowNumbers).toEqual([2, 4])
  })

  it('handles CRLF and a UTF-8 BOM', async () => {
    const r = await parseCSV(b64('﻿nombre;stock\r\nA;1\r\nB;2\r\n'))
    expect(r.errors).toEqual([])
    expect(Object.keys(r.data[0])).toEqual(['nombre', 'stock'])
    expect(r.rowNumbers).toEqual([2, 3])
  })
})

describe('parseCSV — truly unreadable files abort', () => {
  it('returns a fatal error when there is no header/data at all', async () => {
    const r = await parseCSV(b64(''))
    expect(r.data).toEqual([])
    expect(r.totalRows).toBe(0)
  })
})

async function xlsxBase64(rows: Array<Array<string | number | null>>, blankRowAt?: number) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Hoja1')
  rows.forEach((values, i) => {
    if (blankRowAt === i + 1) return
    ws.getRow(i + 1).values = values as ExcelJS.CellValue[]
  })
  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf as ArrayBuffer).toString('base64')
}

describe('parseExcel — row numbers', () => {
  it('reports the real sheet line when a banner sits above the header', async () => {
    const file = await xlsxBase64([
      ['Lista de precios 2026'],
      ['nombre', 'stock', 'precioVenta'],
      ['Funda', 3, 1500],
      ['Vidrio', 2, 800],
    ])
    const r = await parseExcel(file)
    expect(r.errors).toEqual([])
    expect(r.data).toHaveLength(2)
    expect(r.rowNumbers).toEqual([3, 4])
    // numeric cells stay native numbers
    expect(r.data[0].precioVenta).toBe(1500)
  })

  it('accounts for blank rows between records', async () => {
    const file = await xlsxBase64(
      [['nombre', 'stock'], ['A', 1], [null, null], ['B', 2]],
      3,
    )
    const r = await parseExcel(file)
    expect(r.data.map((d) => d.nombre)).toEqual(['A', 'B'])
    expect(r.rowNumbers).toEqual([2, 4])
  })

  it('exposes rowErrors as an empty list', async () => {
    const file = await xlsxBase64([['nombre', 'stock'], ['A', 1]])
    const r = await parseExcel(file)
    expect(r.rowErrors).toEqual([])
  })
})
