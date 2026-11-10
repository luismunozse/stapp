import { readdirSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// vercel.json aplica 30 s a todo app/api/**. Un cron que no exporta su propio
// maxDuration se corta a los 30 s (recordatorios lo hacia a la hora de mas
// carga y las organizaciones del final de la lista no recibian nada ese dia).
const DIR = join(__dirname, "..", "..", "app", "api", "cron")
const RUTAS = readdirSync(DIR)
  .map((d) => join(DIR, d, "route.ts"))
  .filter((p) => existsSync(p))

describe("rutas cron con 60 s de limite", () => {
  it("hay rutas cron para revisar", () => {
    expect(RUTAS.length).toBeGreaterThan(5)
  })

  it.each(RUTAS.map((r) => [r.split("/cron/")[1]]))("%s exporta maxDuration = 60", (ruta) => {
    const fuente = readFileSync(join(DIR, ruta), "utf8")
    expect(fuente).toMatch(/^export const maxDuration = 60$/m)
  })
})
