import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'

/**
 * Architectural guard: commission is computed in ONE place, the database
 * definition (`v_comisiones_filas`), read through `lib/commissions/*`.
 *
 * No source file outside a short allowed list may compute a commission amount,
 * read the legacy views, or write the legacy `comision_pagada` flag.
 */

type Rule = 'vista-legada' | 'calcula' | 'escribe-flag'

const ROOTS = ['app', 'components', 'lib', 'hooks', 'contexts']

// slice 4: reports switch to the definition
const ALLOWED = new Set([
  'app/api/reportes/estado-resultados/route.ts', // slice 4: reports switch to the definition
  'app/api/reportes/tendencia-financiera/route.ts', // slice 4: reports switch to the definition
  'app/api/reportes/rentabilidad/route.ts', // slice 4: reports switch to the definition
  'app/api/reportes/rentabilidad-tecnicos/route.ts', // slice 4: reports switch to the definition
])

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

export function findCommissionOffenders(
  files: Array<{ path: string; source: string }>,
): Array<{ path: string; rule: Rule }> {
  const out: Array<{ path: string; rule: Rule }> = []
  for (const { path, source: raw } of files) {
    const source = stripComments(raw)
    if (/v_comisiones_ordenes|v_comisiones_ventas/.test(source)) {
      out.push({ path, rule: 'vista-legada' })
    }
    if (/porcentaje_comision|porcentajeComision/.test(source)) {
      const computes = source
        .split('\n')
        .some((line) => /[*/]\s*100\b/.test(line) && /pct|porcentaje|comision/i.test(line))
      if (computes) out.push({ path, rule: 'calcula' })
    }
    if (/comision_pagada\s*:\s*(true|false)/.test(source)) {
      out.push({ path, rule: 'escribe-flag' })
    }
  }
  return out
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === '__tests__' || name === 'node_modules') return []
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return walk(full)
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [full] : []
  })
}

function sources(): Array<{ path: string; source: string }> {
  const cwd = process.cwd()
  return ROOTS.flatMap((root) => {
    try {
      return walk(join(cwd, root))
    } catch {
      return []
    }
  }).map((full) => ({
    path: relative(cwd, full).split(sep).join('/'),
    source: readFileSync(full, 'utf8'),
  }))
}

describe('commission calculation sweep', () => {
  it('the detector catches each rule and ignores percentage formatting', () => {
    expect(
      findCommissionOffenders([
        { path: 'a.ts', source: 'supabaseAdmin.from("v_comisiones_ventas")' },
        { path: 'b.ts', source: 'const pct = Number(o.porcentaje_comision)\nconst c = Math.round(g * pct) / 100' },
        { path: 'c.ts', source: '.update({ comision_pagada: true })' },
        { path: 'd.ts', source: 'porcentajeComision\nreturn `${(n * 100).toFixed(0)}%`' },
        { path: 'e.ts', source: '// v_comisiones_ventas in a comment\nporcentaje_comision' },
      ]).map((o) => o.rule),
    ).toEqual(['vista-legada', 'calcula', 'escribe-flag'])
  })

  it('no source file outside the allowed list computes commission, reads a legacy view or writes the flag', () => {
    expect(
      findCommissionOffenders(sources()).filter((o) => !(o.rule === 'calcula' && ALLOWED.has(o.path))),
    ).toEqual([])
  })

  it('every allowed file still computes (a fixed report leaves the list)', () => {
    const calc = new Set(
      findCommissionOffenders(sources())
        .filter((o) => o.rule === 'calcula')
        .map((o) => o.path),
    )
    expect([...ALLOWED].filter((p) => !calc.has(p))).toEqual([])
  })
})
