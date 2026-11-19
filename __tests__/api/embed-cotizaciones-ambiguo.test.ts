import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

// ordenes_servicio y cotizaciones estan unidas por DOS foreign keys
// (cotizaciones.orden_id y cotizaciones.convertida_a_orden_id, migracion 126).
// Un embed pelado `cotizaciones (...)` desde ordenes_servicio hace que
// PostgREST responda PGRST201 ("more than one relationship was found") y la
// consulta entera falla: generar remito devolvia "Orden no encontrada" y los
// reportes quedaban sin ordenes. Los mocks de Supabase no ven ese error, asi
// que se cuida en el texto de la consulta.
const RAIZ = join(__dirname, "..", "..")
const EMBED_PELADO = /^\s*cotizaciones\s*\(/m

function archivosTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = join(dir, e.name)
    if (e.isDirectory()) return archivosTs(ruta)
    return /\.tsx?$/.test(e.name) ? [ruta] : []
  })
}

describe("embed de cotizaciones desde ordenes_servicio", () => {
  it("siempre nombra la foreign key (cotizaciones!cotizaciones_orden_id_fkey)", () => {
    const culpables = [join(RAIZ, "app", "api"), join(RAIZ, "lib")]
      .flatMap(archivosTs)
      .filter((ruta) => {
        const src = readFileSync(ruta, "utf8")
        return src.includes('from("ordenes_servicio")') && EMBED_PELADO.test(src)
      })
      .map((ruta) => relative(RAIZ, ruta))

    expect(culpables).toEqual([])
  })
})
