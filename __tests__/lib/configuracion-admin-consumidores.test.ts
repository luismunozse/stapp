import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join, relative, resolve } from "node:path"

/**
 * Guarda de regresión: GET /api/configuracion es solo ADMIN.
 *
 * Una pantalla que la usen otros roles y lea de ahí recibe 403 y sigue con
 * valores por defecto sin avisar: el POS cobraba sin IVA, la cotización de un
 * vendedor arrancaba con IVA 0, el inventario marcaba stock bajo con otro
 * umbral y el WhatsApp a clientes salía sin el nombre del negocio. Lo que
 * necesita cualquier rol está en /api/configuracion/operativa.
 *
 * Solo pueden leer /api/configuracion las pantallas de administración.
 */
const PERMITIDOS = [
  "components/configuracion/", // pantallas de configuración (ADMIN)
  "components/onboarding/onboarding-wizard.tsx", // solo se redirige a ADMIN
]

const CARPETAS = ["app", "components", "contexts", "hooks", "lib"]

function archivos(dir: string): string[] {
  let entradas
  try {
    entradas = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entradas.flatMap((e) => {
    const ruta = join(dir, e.name)
    if (e.isDirectory()) return e.name === "node_modules" ? [] : archivos(ruta)
    return /\.(ts|tsx)$/.test(e.name) ? [ruta] : []
  })
}

function sinComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\r\n]*/g, "$1")
}

// "/api/configuracion" exacto (con o sin query), no sus subrutas como /operativa.
const ENDPOINT_ADMIN = /["'`]\/api\/configuracion(?:["'`?])/

describe("consumidores de GET /api/configuracion (solo ADMIN)", () => {
  it("ninguna pantalla que usen otros roles lee la configuración de admin", () => {
    const raiz = resolve(process.cwd())
    const infractores = CARPETAS.flatMap((c) => archivos(join(raiz, c)))
      .map((ruta) => relative(raiz, ruta).split("\\").join("/"))
      .filter((rel) => !rel.startsWith("app/api/"))
      .filter((rel) => !PERMITIDOS.some((p) => rel.startsWith(p)))
      .filter((rel) => ENDPOINT_ADMIN.test(sinComentarios(readFileSync(join(raiz, rel), "utf-8"))))

    expect(infractores).toEqual([])
  })
})
