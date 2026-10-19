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
  "app/api/ventas/[id]/devolucion/[devolucionId]/anular/route.ts": "anula: relee por id la NC recién anulada para responderla",
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

describe("barrido: las funciones y vistas vivas que leen NC de venta ignoran las anuladas", () => {
  const DIR = join(RAIZ, "supabase", "migrations")
  const sinComentarios = (sql: string) => sql.replace(/--[^\n]*/g, "")

  type Evento =
    | { en: number; tipo: "crear"; nombre: string; cuerpo: string }
    | { en: number; tipo: "renombrar"; nombre: string; nuevo: string }
    | { en: number; tipo: "borrar"; nombre: string }

  /** CREATE, RENAME y DROP de funciones y vistas de un archivo, en orden. */
  function eventos(sql: string): Evento[] {
    const out: Evento[] = []
    for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?(FUNCTION|VIEW)\s+(?:public\.)?(\w+)/gi)) {
      const desde = m.index!
      let hasta: number
      if (m[1].toUpperCase() === "FUNCTION") {
        const resto = sql.slice(desde)
        const tag = /\bAS\s+(\$[A-Za-z_]*\$)/i.exec(resto)
        if (!tag) continue
        const cierra = resto.indexOf(tag[1], tag.index + tag[0].length)
        hasta = desde + resto.indexOf(";", cierra) + 1
      } else {
        hasta = sql.indexOf(";", desde) + 1
      }
      out.push({ en: desde, tipo: "crear", nombre: m[2].toLowerCase(), cuerpo: sql.slice(desde, hasta) })
    }
    for (const m of sql.matchAll(/ALTER\s+FUNCTION\s+(?:public\.)?(\w+)\s*\([^)]*\)\s*RENAME\s+TO\s+(\w+)/gi)) {
      out.push({ en: m.index!, tipo: "renombrar", nombre: m[1].toLowerCase(), nuevo: m[2].toLowerCase() })
    }
    for (const m of sql.matchAll(/DROP\s+(?:FUNCTION|VIEW)\s+(?:IF\s+EXISTS\s+)?(?:public\.)?(\w+)/gi)) {
      out.push({ en: m.index!, tipo: "borrar", nombre: m[1].toLowerCase() })
    }
    return out.sort((a, b) => a.en - b.en)
  }

  /** La ultima definicion de cada funcion o vista con las migraciones de numero menor a `tope`. */
  function vivasHasta(tope = Infinity) {
    const out = new Map<string, { archivo: string; cuerpo: string }>()
    const archivos = readdirSync(DIR).filter((f) => /^\d{3}_.*\.sql$/.test(f) && Number(f.slice(0, 3)) < tope)
    for (const archivo of archivos.sort()) {
      for (const e of eventos(sinComentarios(readFileSync(join(DIR, archivo), "utf8")))) {
        if (e.tipo === "crear") out.set(e.nombre, { archivo, cuerpo: e.cuerpo })
        else if (e.tipo === "borrar") out.delete(e.nombre)
        else {
          const d = out.get(e.nombre)
          if (d) {
            out.set(e.nuevo, d)
            out.delete(e.nombre)
          }
        }
      }
    }
    return out
  }

  // La ultima definicion de cada funcion o vista: como queda la base.
  const vivas = vivasHasta()
  const leen = [...vivas].filter(([, d]) => TABLAS.test(d.cuerpo)).map(([n]) => n).sort()

  // Minimo de "anulada = false" en la ultima definicion de cada una.
  const FILTROS_SQL: Record<string, number> = {
    // LIFO, lo devuelto por las otras NC de la linea (garantia) y la cobertura de estado_pago.
    anular_devolucion_venta: 3,
    registrar_devolucion_atomica: 1,
    registrar_devolucion_monto: 1,
    registrar_devolucion_nucleo: 5,
    registrar_pagos_venta_atomica: 1,
    restore_stock_on_cancel: 1,
    v_cc_drift: 1,
    v_comisiones_ventas: 1,
  }
  const EXCEPCIONES_SQL: Record<string, string> = {
    editar_venta_atomica:
      "editar sigue bloqueado con cualquier NC, tambien anulada: las lineas de una NC anulada referencian items_venta",
    v_notas_credito: "el listado muestra las anuladas con su estado",
  }

  it("cada funcion o vista viva que lee esas tablas filtra o esta justificada", () => {
    const sinDecidir = leen.filter((n) => !(n in FILTROS_SQL) && !(n in EXCEPCIONES_SQL))
    expect(sinDecidir, "agregala a FILTROS_SQL (con su minimo de anulada = false) o a EXCEPCIONES_SQL").toEqual([])
  })

  it.each(Object.entries(FILTROS_SQL))("%s filtra anulada = false al menos %i veces", (nombre, minimo) => {
    const d = vivas.get(nombre)
    expect(d, `${nombre} no esta viva`).toBeDefined()
    expect(d!.cuerpo.match(/\b(?:\w+\.)?anulada\s*=\s*false\b/gi)?.length ?? 0, d!.archivo).toBeGreaterThanOrEqual(minimo)
  })

  // La 368 redefine estos cinco objetos copiando una version fija (notas-credito-
  // migraciones.test.ts compara contra esos archivos). Si una migracion anterior a
  // la 368 los redefine despues (otra rama mergeada antes), la copia volveria
  // atras ese cambio sin que nadie lo note: este test lo frena.
  it("la 368 copia la ultima definicion anterior de cada objeto que redefine", () => {
    const COPIADAS: Record<string, string> = {
      registrar_devolucion_nucleo: "330_devolucion_descuenta_saldo.sql",
      registrar_pagos_venta_atomica: "331_cobros_venta_idempotencia_y_cliente.sql",
      restore_stock_on_cancel: "334_anular_venta_series_y_garantias.sql",
      v_comisiones_ventas: "333_comision_neta_de_devoluciones.sql",
      v_cc_drift: "245_v_cc_drift.sql",
    }
    const antes = vivasHasta(368)
    const ultima = Object.fromEntries(Object.keys(COPIADAS).map((n) => [n, antes.get(n)?.archivo]))
    expect(ultima, "una migracion anterior a la 368 redefine un objeto que la 368 copia: rehacer la copia").toEqual(COPIADAS)
  })
})
