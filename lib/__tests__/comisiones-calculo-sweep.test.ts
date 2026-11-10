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

/**
 * Reception attribution: the trigger snapshots the receiver's rate from `recibido_por`.
 * Checked here: (1) the per-person rate has exactly four writers; (2) exactly three files write
 * `recibido_por`; (3) every file that creates an order is either one of those writers, or listed
 * in NO_RECEIVER_BY_DESIGN / RECEIVER_VIA_RPC with its reason, so a new creation path cannot
 * skip the receiver unnoticed. Whether a listed path should set a receiver is a product call.
 */
const RATE_WRITERS = [
  'app/api/vendedores/route.ts',
  'app/api/vendedores/[id]/route.ts',
  'app/api/tecnicos/route.ts',
  'app/api/tecnicos/[id]/route.ts',
]
const RECEIVER_WRITERS = [
  'app/api/ordenes/route.ts',
  'app/api/onboarding/practica/route.ts',
  'app/api/cotizaciones/[id]/convertir-orden/route.ts',
]

// Order-creation sites that deliberately set no receiver (the trigger then snapshots no rate).
const NO_RECEIVER_BY_DESIGN: Record<string, string> = {
  'lib/onboarding/sample-data.ts': 'demo/sample orders for onboarding, not real receptions',
  'app/api/onboarding/seed-demo-data/route.ts': 'demo orders seeded for onboarding, not real receptions',
  'app/api/ordenes/[id]/reingreso/route.ts': 're-entry of an existing order; warranty re-entries have no reception commission',
  'app/api/garantias/[id]/reclamos/route.ts': 'repair order opened from a warranty claim; warranty re-entries have no reception commission',
}
// Order creation through an RPC that takes the receiver as a parameter (`p_recibido_por`).
const RECEIVER_VIA_RPC = ['app/api/recepciones/route.ts']

/** Files that create an order: an insert straight after `.from("ordenes_servicio")`, or the multi-reception RPC. */
export function filesCreatingOrders(files: Array<{ path: string; source: string }>): string[] {
  const direct = /from\(\s*["']ordenes_servicio["']\s*\)\s*\.(?:insert|upsert)\(/
  const rpc = /rpc\(\s*["']crear_recepcion_multiple["']/
  return files
    .filter((f) => {
      const code = stripComments(f.source)
      return direct.test(code) || rpc.test(code)
    })
    .map((f) => f.path)
    .sort()
}

/** Files whose code (comments stripped) writes `key` as an object key or a property assignment, not as a suffix of another name. */
export function filesWithObjectKey(files: Array<{ path: string; source: string }>, key: string): string[] {
  const pattern = new RegExp(`(?<![A-Za-z0-9_])${key}\\s*(?::|=(?!=))`)
  return files.filter((f) => pattern.test(stripComments(f.source))).map((f) => f.path).sort()
}

describe('reception attribution', () => {
  it('the key detector ignores comments and longer names', () => {
    expect(
      filesWithObjectKey(
        [
          { path: 'a.ts', source: 'insert({ recibido_por: userId })' },
          { path: 'b.ts', source: '// recibido_por: in a comment' },
          { path: 'c.ts', source: 'rpc("f", { p_recibido_por: id })' },
          { path: 'd.ts', source: 'update.recibido_por = userId' },
          { path: 'e.ts', source: 'if (row.recibido_por === userId) {}' },
        ],
        'recibido_por',
      ),
    ).toEqual(['a.ts', 'd.ts'])
  })

  it('only the four rate-writer routes write porcentaje_comision_recepcion', () => {
    expect(filesWithObjectKey(sources(), 'porcentaje_comision_recepcion')).toEqual([...RATE_WRITERS].sort())
  })

  it('only the three order-creation paths write recibido_por', () => {
    expect(filesWithObjectKey(sources(), 'recibido_por')).toEqual([...RECEIVER_WRITERS].sort())
  })

  it('the order-creation detector sees direct inserts and the RPC, not updates or comments', () => {
    expect(
      filesCreatingOrders([
        { path: 'a.ts', source: 'await supabaseAdmin' + String.fromCharCode(10) + '  .from("ordenes_servicio")' + String.fromCharCode(10) + '  .insert({ x: 1 })' },
        { path: 'b.ts', source: 'supabaseAdmin.from("ordenes_servicio").update({ x: 1 })' },
        { path: 'c.ts', source: '// .from("ordenes_servicio").insert({})' },
        { path: 'd.ts', source: 'await supabaseAdmin.rpc("crear_recepcion_multiple", {})' },
      ]),
    ).toEqual(['a.ts', 'd.ts'])
  })

  it('every order-creation path sets a receiver or is listed with a reason', () => {
    const known = new Set([...RECEIVER_WRITERS, ...RECEIVER_VIA_RPC, ...Object.keys(NO_RECEIVER_BY_DESIGN)])
    expect(filesCreatingOrders(sources()).filter((p) => !known.has(p))).toEqual([])
  })

  it('the order-creation lists still match (no dead or duplicated entry)', () => {
    const creators = new Set(filesCreatingOrders(sources()))
    const exemptions = [...RECEIVER_VIA_RPC, ...Object.keys(NO_RECEIVER_BY_DESIGN)]
    expect(exemptions.filter((p) => !creators.has(p))).toEqual([])
    expect(exemptions.filter((p) => RECEIVER_WRITERS.includes(p))).toEqual([])
    expect(RECEIVER_WRITERS.filter((p) => !creators.has(p))).toEqual([])
  })

  it('the listed files still match (a renamed route cannot leave a dead entry)', () => {
    const all = sources()
    const rate = new Set(filesWithObjectKey(all, 'porcentaje_comision_recepcion'))
    const receiver = new Set(filesWithObjectKey(all, 'recibido_por'))
    expect(RATE_WRITERS.filter((p) => !rate.has(p))).toEqual([])
    expect(RECEIVER_WRITERS.filter((p) => !receiver.has(p))).toEqual([])
  })
})
