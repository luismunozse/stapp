import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { GRACIA_CONCILIACION_MS } from "@/lib/facturacion/arca/conciliar-nota-credito"

// Las rutas que hablan con ARCA encadenan hasta 4 llamadas (WSAA, consulta, último
// autorizado, envío). Con el límite general de 30 s, un ARCA lento corta la función
// DESPUÉS del envío y el comprobante queda "pendiente". Van a 60 s, como export.
const RAIZ = join(__dirname, "..", "..")
const RUTAS = [
  "app/api/facturacion-electronica/emitir/route.ts",
  "app/api/facturacion-electronica/comprobantes/[id]/anular/route.ts",
  "app/api/facturacion-electronica/comprobantes/[id]/verificar/route.ts",
]

const vercel = JSON.parse(readFileSync(join(RAIZ, "vercel.json"), "utf8")) as {
  functions: Record<string, { maxDuration?: number }>
}

describe("rutas de ARCA con 60 s de límite", () => {
  it.each(RUTAS)("%s exporta maxDuration = 60", (ruta) => {
    const fuente = readFileSync(join(RAIZ, ruta), "utf8")
    expect(fuente).toMatch(/^export const maxDuration = 60$/m)
  })

  it("vercel.json le da 60 s a emitir", () => {
    expect(vercel.functions["app/api/facturacion-electronica/emitir/route.ts"]?.maxDuration).toBe(60)
  })

  it("vercel.json le da 60 s a anular y verificar sin corchetes en el glob", () => {
    // `[id]` en un glob es una clase de caracteres ("i" o "d"), no el segmento literal.
    const glob = "app/api/facturacion-electronica/comprobantes/*/*/route.ts"
    expect(vercel.functions[glob]?.maxDuration).toBe(60)
    expect(Object.keys(vercel.functions).some((k) => k.includes("["))).toBe(false)
  })

  it("la gracia de conciliación sigue siendo mayor que el límite más largo", () => {
    const maximo = Math.max(...Object.values(vercel.functions).map((f) => f.maxDuration ?? 0))
    expect(GRACIA_CONCILIACION_MS).toBeGreaterThan(maximo * 1000)
  })
})
