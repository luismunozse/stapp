// @vitest-environment node
/**
 * Sweep (change sucursales-aislamiento, PR3; XC-1, XC-2, OI-1, OI-2): every handler of the order
 * detail route and its 14 sub-routes reads the order through `cargarOrdenEnAlcance`, or is listed
 * in EXENTOS with the reason it does not need to.
 *
 * Handler by handler, not file by file: a route that scopes its POST but forgets its GET is the
 * kind of miss a file-level check lets through. A new sub-route (or a new method on one) that
 * skips the loader fails here until it is wired or exempted with a reason.
 */
import { describe, it, expect } from "vitest"
import { leerFuentes, sinComentarios } from "../helpers/fuentes"

const RUTA = /^app\/api\/ordenes\/\[id\]\/(?:(.+)\/)?route\.ts$/

/** The route and its 14 sub-routes, as the directory names them. */
const SUBRUTAS = [
  "checklist",
  "cobros",
  "comprobante-entrega",
  "cuotas",
  "entregar",
  "eventos",
  "fotos",
  "fotos/[fotoId]",
  "notas-credito",
  "pdf",
  "reingreso",
  "repuestos",
  "servicios",
  "tomar",
]

// Handlers that do not call the loader, and why that is safe. Key: `<route>#<METHOD>`.
const EXENTOS = new Map<string, string>([
  [
    "cobros#DELETE",
    "ADMIN only: the role check comes first, so anybody else gets the same 403 for any id, and an ADMIN's scope is the whole organization",
  ],
  [
    "cuotas#PUT",
    "ADMIN only: the role check comes first, so anybody else gets the same 403 for any id, and an ADMIN's scope is the whole organization",
  ],
])

interface Manejador {
  metodo: string
  cuerpo: string
}

/** The exported HTTP handlers of a route file, each with the code up to the next one (comments removed). */
function manejadores(src: string): Manejador[] {
  const codigo = sinComentarios(src)
  const marcas = [...codigo.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => ({
    metodo: m[1],
    desde: m.index!,
  }))
  return marcas.map((m, i) => ({ metodo: m.metodo, cuerpo: codigo.slice(m.desde, marcas[i + 1]?.desde ?? codigo.length) }))
}

const cargaPorElAlcance = (cuerpo: string) => /\bcargarOrdenEnAlcance\s*\(/.test(cuerpo)

describe("detector", () => {
  const ruta = (...cuerpos: string[]) => cuerpos.join("\n")

  it("finds each exported HTTP handler and not the helpers around them", () => {
    const src = ruta(
      "function auxiliar() { return 1 }",
      "export async function GET(request: Request) { return 1 }",
      "async function otraCosa() { return 2 }",
      "export async function DELETE(request: Request) { return 3 }",
    )

    expect(manejadores(src).map((m) => m.metodo)).toEqual(["GET", "DELETE"])
  })

  it("accepts a handler that calls the loader", () => {
    const [get] = manejadores(`export async function GET() { const c = await cargarOrdenEnAlcance(id, actor, "ver") }`)

    expect(cargaPorElAlcance(get.cuerpo)).toBe(true)
  })

  it("flags a handler that reads the order itself", () => {
    const [get] = manejadores(
      `export async function GET() { const { data } = await supabaseAdmin.from("ordenes_servicio").select("id").single() }`,
    )

    expect(cargaPorElAlcance(get.cuerpo)).toBe(false)
  })

  it("does not credit a handler with the call of its neighbour", () => {
    const [get, post] = manejadores(
      ruta(
        `export async function GET() { await cargarOrdenEnAlcance(id, actor, "ver") }`,
        `export async function POST() { await supabaseAdmin.from("ordenes_servicio").select("id") }`,
      ),
    )

    expect(cargaPorElAlcance(get.cuerpo)).toBe(true)
    expect(cargaPorElAlcance(post.cuerpo)).toBe(false)
  })

  it("is not fooled by a call mentioned in a comment", () => {
    const [get] = manejadores(
      ruta(
        "export async function GET() {",
        "  // TODO: cargarOrdenEnAlcance(id, actor, 'ver')",
        "  /* cargarOrdenEnAlcance(id) */",
        "  return 1",
        "}",
      ),
    )

    expect(cargaPorElAlcance(get.cuerpo)).toBe(false)
  })
})

describe("source tree", () => {
  const archivos = leerFuentes(["app/api/ordenes"]).filter((a) => RUTA.test(a.rel))
  const nombreDe = (rel: string) => RUTA.exec(rel)![1] ?? "(detalle)"
  const todos = archivos.flatMap((a) => manejadores(a.src).map((m) => ({ ruta: nombreDe(a.rel), ...m })))

  it("scans the real tree: the route and its 14 sub-routes", () => {
    expect(SUBRUTAS).toHaveLength(14)
    expect(archivos.map((a) => nombreDe(a.rel)).sort()).toEqual(["(detalle)", ...SUBRUTAS].sort())
    // 3 on the detail route + 26 on the sub-routes today.
    expect(todos.length).toBeGreaterThanOrEqual(29)
  })

  it("every handler reads the order through cargarOrdenEnAlcance, or is exempt with a reason", () => {
    const sinCargador = todos
      .filter((h) => !cargaPorElAlcance(h.cuerpo) && !EXENTOS.has(`${h.ruta}#${h.metodo}`))
      .map((h) => `${h.ruta}#${h.metodo}`)

    expect(sinCargador).toEqual([])
  })

  it("every exemption names a handler that exists, and that handler really does not call the loader", () => {
    const porClave = new Map(todos.map((h) => [`${h.ruta}#${h.metodo}`, h]))

    for (const [clave, motivo] of EXENTOS) {
      expect(porClave.has(clave), `${clave} does not exist`).toBe(true)
      expect(motivo.length, clave).toBeGreaterThan(20)
      expect(cargaPorElAlcance(porClave.get(clave)!.cuerpo), `${clave} is exempt but calls the loader`).toBe(false)
    }
  })
})
