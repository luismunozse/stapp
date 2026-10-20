import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public')
const sw = readFileSync(path.join(PUBLIC_DIR, 'sw.js'), 'utf8')

function staticAssets(): string[] {
  const match = sw.match(/const STATIC_ASSETS = \[([\s\S]*?)\]/)
  if (!match) throw new Error('STATIC_ASSETS not found in public/sw.js')
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1])
}

describe('public/sw.js precache', () => {
  it('lists at least one static asset', () => {
    expect(staticAssets().length).toBeGreaterThan(0)
  })

  it.each(staticAssets())('STATIC_ASSETS entry %s exists under public/', (url) => {
    expect(existsSync(path.join(PUBLIC_DIR, url))).toBe(true)
  })

  it('does not precache atomically (one 404 would block SW install, push and offline)', () => {
    expect(sw).not.toMatch(/cache\.addAll\(/)
  })
})
