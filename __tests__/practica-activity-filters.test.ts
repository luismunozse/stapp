// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

// These routes measure activity or feature usage. The onboarding practice
// creates a client of its own, and that client must not make an org look
// active. No suite runs these routes, so this pins the filter by text.
const RUTAS = [
  "app/api/cron/re-engagement/route.ts",
  "app/api/cron/auto-archive-dormant/route.ts",
  "app/api/cron/trial-management/route.ts",
  "app/api/cron/engagement/route.ts",
  "app/api/superadmin/subscriptions/route.ts",
  "app/api/superadmin/stats/feature-usage/route.ts",
  "app/api/superadmin/stats/engagement/route.ts",
]

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8")

/**
 * Each clientes query: a `.from("clientes")` chain or a
 * `fetchAllRows(..., "clientes", ...)` call, up to the next query or the end
 * of the Promise.all array it sits in.
 */
function consultasDeClientes(src: string): string[] {
  const consultas: string[] = []
  const inicios = [/\.from\("clientes"\)/g, /fetchAllRows<[^>]*>\("clientes"/g]
  for (const re of inicios) {
    for (const m of src.matchAll(re)) {
      const desde = m.index as number
      const fines = [
        src.indexOf("supabaseAdmin", desde),
        src.indexOf("fetchAllRows", desde + 1),
        src.indexOf("])", desde),
      ].filter((i) => i !== -1)
      const hasta = fines.length > 0 ? Math.min(...fines) : src.length
      consultas.push(src.slice(desde, hasta))
    }
  }
  return consultas
}

describe("activity and usage counts leave out the practice client", () => {
  it.each(RUTAS)("%s filters every clientes query by es_practica = false", (ruta) => {
    const consultas = consultasDeClientes(leer(ruta))
    expect(consultas.length).toBeGreaterThan(0)
    for (const consulta of consultas) {
      expect(consulta).toContain('.eq("es_practica", false)')
    }
  })

  it("app/api/cron/feature-usage/route.ts counts only real clients", () => {
    expect(leer("app/api/cron/feature-usage/route.ts")).toMatch(
      /countRows\("clientes", o, undefined, \{ soloReales: true \}\)/
    )
  })
})
