// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "fs"
import { join, relative, sep } from "path"

/**
 * Barrido de consumidores (spec, "Tests"): toda lectura de las NC de venta
 * (devoluciones_venta, items_devolucion) ignora las anuladas, o figura acá con
 * el motivo por el que no hace falta. Una NC anulada que un lector sigue
 * contando hace mentir a ese lector sin que nadie lo note.
 */
const RAIZ = process.cwd()
const TABLAS = /\b(devoluciones_venta|items_devolucion)\b/

function fuentes(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre)
    if (statSync(ruta).isDirectory()) return nombre === "__tests__" ? [] : fuentes(ruta)
    return /\.tsx?$/.test(nombre) && !/\.test\.tsx?$/.test(nombre) ? [ruta] : []
  })
}
const sinComentarios = (codigo: string) =>
  codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"\x27\x60])\/\/.*$/gm, "$1")

// Forma del filtro en el CODIGO (un comentario que diga "anulada" no cuenta).
const FILTROS_ANULADA = [
  /\.eq\(\s*["\x27]anulada["\x27]\s*,\s*false\s*\)/, // filtro en la consulta
  /(devoluciones_venta|items_devolucion)\s*\([^"\x27\x60]*\banulada\b[^"\x27\x60]*\)/, // embed que pide anulada
  /\banulada\s*!==\s*true\b|!\s*\w+\??\.anulada\b/, // filtro en memoria
]
const relativo = (ruta: string) => relative(RAIZ, ruta).split(sep).join("/")

// Filtran: miran `anulada` (en la consulta o en el embed que recorren).
const FILTRAN = [
  "app/api/facturacion-electronica/emitir/route.ts",
  "app/api/reportes/estado-resultados/route.ts",
  "app/api/reportes/ventas-analytics/route.ts",
  "lib/db-utils.ts",
  "lib/notas-credito/documento.ts",
]

// Leen las tablas sin filtrar, a propósito.
const EXCEPCIONES: Record<string, string> = {
  "app/superadmin/logs/page.tsx": "solo la etiqueta de la entidad de auditoría",
  "lib/audit.ts": "solo el tipo y la etiqueta de la entidad de auditoría",
  "lib/superadmin-audit.ts": "solo el tipo de la entidad",
  "lib/devolucion-refund.ts": "solo comentarios",
  "lib/ventas/bloqueos.ts":
    "editar la venta sigue bloqueado con cualquier NC, también anulada: editar_venta_atomica borra y recrea items_venta, y las líneas de una NC anulada los referencian",
  "app/api/ventas/route.ts": "lista y alta: traen todas las NC con su estado (formatVenta y el diálogo ignoran las anuladas)",
  "app/api/ventas/[id]/route.ts": "detalle: trae todas las NC con su estado; el saldo sale de saldoPendienteVenta",
  "app/api/ventas/[id]/pagos/route.ts": "el pendiente sale de saldoPendienteVenta, que filtra",
  "app/api/ventas/[id]/devolucion/route.ts": "historial de NC de la venta (con su estado) y relectura de la recién emitida",
  "app/api/inventario/[id]/route.ts": "un producto con NC no se borra, aunque la NC esté anulada: su documento lo nombra",
  "app/api/inventario/bulk/route.ts": "un producto con NC no se borra, aunque la NC esté anulada",
  "app/api/inventario/all/route.ts": "un producto con NC no se borra, aunque la NC esté anulada",
}

describe("barrido: las NC anuladas no cuentan en app/ ni en lib/, components/ ni hooks/", () => {
  const lectores = [...fuentes(join(RAIZ, "app")), ...fuentes(join(RAIZ, "lib")), ...fuentes(join(RAIZ, "components")), ...fuentes(join(RAIZ, "hooks"))]
    .filter((ruta) => TABLAS.test(readFileSync(ruta, "utf8")))
    .map(relativo)
    .sort()

  it("cada archivo que lee devoluciones_venta o items_devolucion filtra o está justificado", () => {
    const sinDecidir = lectores.filter((r) => !FILTRAN.includes(r) && !(r in EXCEPCIONES))
    expect(sinDecidir, "agregalo a FILTRAN (con su filtro de anulada) o a EXCEPCIONES con el motivo").toEqual([])
  })

  it.each(FILTRAN)("%s filtra anulada en el codigo", (archivo) => {
    const codigo = sinComentarios(readFileSync(join(RAIZ, archivo), "utf8"))
    expect(FILTROS_ANULADA.some((f) => f.test(codigo)), 'falta .eq("anulada", false), un embed con anulada o un filtro en memoria').toBe(true)
  })

  it("las listas no nombran archivos que ya no leen esas tablas", () => {
    for (const archivo of [...FILTRAN, ...Object.keys(EXCEPCIONES)]) expect(lectores, archivo).toContain(archivo)
  })
})
