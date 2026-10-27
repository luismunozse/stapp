import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

// requireAuth() hands API routes the user's CURRENT branch, but a server page
// that calls auth() itself reads `session.user.sucursalId` straight from the
// JWT, which is stale for up to ~18 h after an ADMIN moves the user. Such a page
// has to go through sesionConSucursalVigente() (lib/auth-utils.ts), or be listed
// here with the reason it can live with the JWT value.
const ROOT = process.cwd()

// Files that may read the JWT branch. Empty on purpose: today no page or layout
// reads it at all, so every entry added here is a conscious decision.
const EXENTOS = new Map<string, string>()

/** True for a server file that takes the branch from a raw auth() session. */
function leeSucursalDelJwt(src: string): boolean {
  if (/^\s*["']use client["']/m.test(src)) return false
  return /\bawait\s+auth\(\s*\)/.test(src) && /\.sucursalId\b/.test(src) && !src.includes("sesionConSucursalVigente(")
}

function paginasYLayouts(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".") || name === "api") continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) paginasYLayouts(full, out)
    else if (/^(page|layout)\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

describe("detector", () => {
  it("flags a page that reads the branch from a raw auth() session", () => {
    const src = `const session = await auth()\nconst s = session.user.sucursalId`
    expect(leeSucursalDelJwt(src)).toBe(true)
  })

  it("accepts a page that goes through sesionConSucursalVigente()", () => {
    const src = `const session = await sesionConSucursalVigente()\nconst s = session.user.sucursalId`
    expect(leeSucursalDelJwt(src)).toBe(false)
  })

  it("ignores pages that call auth() but never read the branch, and client files", () => {
    expect(leeSucursalDelJwt(`const session = await auth()\nconst o = session.user.organizationId`)).toBe(false)
    expect(leeSucursalDelJwt(`"use client"\nconst x = await auth()\nconst s = user.sucursalId`)).toBe(false)
  })
})

describe("pages and layouts", () => {
  const archivos = paginasYLayouts(join(ROOT, "app")).map((f) => ({
    rel: relative(ROOT, f).split(sep).join("/"),
    src: readFileSync(f, "utf8"),
  }))

  it("scans the real tree (guards against a ghost loop)", () => {
    expect(archivos.length).toBeGreaterThan(20)
    expect(archivos.some((a) => a.rel === "app/(dashboard)/layout.tsx")).toBe(true)
  })

  it("none reads session.user.sucursalId from a raw auth() session", () => {
    const ofensores = archivos
      .filter(({ rel, src }) => leeSucursalDelJwt(src) && !EXENTOS.has(rel))
      .map(({ rel }) => rel)
      .sort()
    expect(ofensores).toEqual([])
  })
})
