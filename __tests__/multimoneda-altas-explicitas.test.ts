import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { sinComentarios } from "./helpers/fuentes"

// Task 4 (REQ-2.4): every catalog insert writes `moneda` explicitly (null = local),
// so nothing relies on the column default.

const leer = (rel: string) => sinComentarios(readFileSync(join(process.cwd(), rel), "utf8"))

/** Source from the first `inicio` to the first `fin` after it (the insert payload region). */
function region(rel: string, inicio: string, fin: string): string {
  const src = leer(rel)
  const i = src.indexOf(inicio)
  expect(i, `${inicio} en ${rel}`).toBeGreaterThan(-1)
  const j = src.indexOf(fin, i)
  expect(j, `${fin} en ${rel}`).toBeGreaterThan(i)
  return src.slice(i, j)
}

const cuenta = (s: string, re: RegExp) => (s.match(re) ?? []).length

describe("altas del catálogo escriben moneda explícita", () => {
  it("inventario/bulk-create", () => {
    const r = region("app/api/inventario/bulk-create/route.ts", '.from("inventario")', ".select(")
    expect(r).toMatch(/moneda: null/)
  })
  it("import (buildInventarioPayload)", () => {
    const r = region("lib/import-inventario-payload.ts", "function buildInventarioPayload", "organization_id")
    expect(r).toMatch(/moneda: null/)
  })
  it("onboarding/seed-demo-data: cada producto", () => {
    const r = region("app/api/onboarding/seed-demo-data/route.ts", "const inventarioPayload = [", '.from("inventario")')
    expect(cuenta(r, /moneda: null/g)).toBe(cuenta(r, /organization_id:/g))
    expect(cuenta(r, /moneda: null/g)).toBeGreaterThan(0)
  })
  it("onboarding/sample-data: cada producto", () => {
    const r = region("lib/onboarding/sample-data.ts", "const inventario = [", '.from("inventario")')
    expect(cuenta(r, /moneda: null/g)).toBe(cuenta(r, /organization_id:/g))
    expect(cuenta(r, /moneda: null/g)).toBeGreaterThan(0)
  })
  it("ordenes/[id]/servicios: alta al catálogo", () => {
    const r = region("app/api/ordenes/[id]/servicios/route.ts", 'from("servicios").insert(', "catalogoError")
    expect(r).toMatch(/moneda: null/)
  })
  it("kits/page envía moneda: null a /api/inventario", () => {
    const r = region("app/(dashboard)/inventario/kits/page.tsx", 'fetch("/api/inventario"', "createRes.ok")
    expect(r).toMatch(/moneda: null/)
  })
  it("buildInventarioPayload devuelve moneda: null", async () => {
    const { buildInventarioPayload } = await import("@/lib/import-inventario-payload")
    const p = buildInventarioPayload({ nombre: "x", stock: 1, precioVenta: 2 }, "C-1", "org-1")
    expect(p).toHaveProperty("moneda", null)
  })
})
