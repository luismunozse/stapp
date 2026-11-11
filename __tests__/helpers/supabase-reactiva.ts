import { vi } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * `supabaseAdmin` en memoria para flujos que escriben y vuelven a leer lo
 * escrito a través de una VISTA (los reclamos de garantía: la vista
 * v_garantias cambia cuando se inserta un reclamo). supabase-memoria.ts sirve
 * para probar que no se tocó nada; esta, para recorrer un ciclo de vida.
 *
 * - Las vistas son funciones de las tablas: se recalculan en cada lectura.
 * - Los hooks hacen de triggers BEFORE e índices únicos.
 * - insert sin id le genera uno; .select() después de una escritura devuelve las filas.
 *
 * Soporta: select (columnas planas; count/head), eq, neq, in, is, not(col, "is",
 * null), gte/lte/gt/lt, or("a.eq.x,b.is.null"), order, range, limit, single,
 * maybeSingle, insert/update/delete.
 */

type Row = Record<string, any>
export type ErrorPg = { code: string; message: string }

export interface OpcionesReactiva {
  vistas?: Record<string, (tablas: Record<string, Row[]>) => Row[]>
  /** Antes de insertar (trigger BEFORE o índice único): puede cambiar la fila o devolver un error. */
  antesDeInsertar?: (tabla: string, fila: Row, tablas: Record<string, Row[]>) => ErrorPg | void
}

export interface BaseReactiva {
  tablas: Record<string, Row[]>
  escrituras: Array<{ tabla: string; op: string; payload: unknown }>
}

let secuencia = 0

function parseOr(expr: string): Array<(r: Row) => boolean> {
  return expr.split(",").map((parte) => {
    const [col, op, ...resto] = parte.split(".")
    const valor = resto.join(".")
    if (op === "eq") return (r: Row) => String(r[col]) === valor
    if (op === "is") return (r: Row) => (valor === "null" ? r[col] == null : String(r[col]) === valor)
    return () => false
  })
}

export function instalarBaseReactiva(inicial: Record<string, Row[]>, opciones: OpcionesReactiva = {}): BaseReactiva {
  const tablas: Record<string, Row[]> = {}
  for (const [k, v] of Object.entries(inicial)) tablas[k] = v.map((r) => ({ ...r }))
  const escrituras: BaseReactiva["escrituras"] = []

  function from(tabla: string) {
    const filtros: Array<(r: Row) => boolean> = []
    const ordenes: Array<{ col: string; asc: boolean }> = []
    let cols: string[] | null = null
    let head = false
    let conCount = false
    let limite: number | null = null
    let rango: [number, number] | null = null
    let mutacion: { op: "insert" | "update" | "delete"; payload: any } | null = null
    let devolver = false

    const filas = (): Row[] => {
      const vista = opciones.vistas?.[tabla]
      if (vista) return vista(tablas)
      return (tablas[tabla] ??= [])
    }

    const q: any = {}
    const encadenar = (nombre: string, fn: (...a: any[]) => void) => {
      q[nombre] = (...a: any[]) => {
        fn(...a)
        return q
      }
    }
    encadenar("select", (c?: string, o?: { count?: string; head?: boolean }) => {
      if (mutacion) {
        devolver = true
        return
      }
      if (typeof c === "string" && c.trim() !== "*") cols = c.split(",").map((x) => x.trim()).filter(Boolean)
      head = !!o?.head
      conCount = !!o?.count
    })
    encadenar("eq", (c: string, v: unknown) => filtros.push((r) => r[c] === v))
    encadenar("neq", (c: string, v: unknown) => filtros.push((r) => r[c] !== v))
    encadenar("in", (c: string, vs: unknown[]) => filtros.push((r) => vs.includes(r[c])))
    encadenar("is", (c: string, v: unknown) => filtros.push((r) => (v === null ? r[c] == null : r[c] === v)))
    encadenar("not", (c: string, op: string, v: unknown) => {
      if (op === "is" && v === null) filtros.push((r) => r[c] != null)
    })
    encadenar("gte", (c: string, v: any) => filtros.push((r) => r[c] != null && String(r[c]) >= String(v)))
    encadenar("lte", (c: string, v: any) => filtros.push((r) => r[c] != null && String(r[c]) <= String(v)))
    encadenar("gt", (c: string, v: any) => filtros.push((r) => r[c] != null && String(r[c]) > String(v)))
    encadenar("lt", (c: string, v: any) => filtros.push((r) => r[c] != null && String(r[c]) < String(v)))
    encadenar("or", (expr: string) => {
      const alguna = parseOr(expr)
      filtros.push((r) => alguna.some((f) => f(r)))
    })
    encadenar("order", (c: string, o?: { ascending?: boolean }) => ordenes.push({ col: c, asc: o?.ascending !== false }))
    encadenar("limit", (n: number) => (limite = n))
    encadenar("range", (a: number, b: number) => (rango = [a, b]))
    encadenar("insert", (payload: any) => (mutacion = { op: "insert", payload }))
    encadenar("update", (payload: any) => (mutacion = { op: "update", payload }))
    encadenar("delete", () => (mutacion = { op: "delete", payload: null }))

    const proyectar = (r: Row): Row => {
      if (!cols) return { ...r }
      const out: Row = {}
      for (const c of cols) if (/^\w+$/.test(c)) out[c] = r[c] ?? null
      return out
    }

    let resultado: { data: any; error: ErrorPg | null; count?: number | null } | null = null
    const ejecutar = () => (resultado ??= correr())
    const correr = (): { data: any; error: ErrorPg | null; count?: number | null } => {
      if (mutacion) {
        escrituras.push({ tabla, op: mutacion.op, payload: mutacion.payload })
        const t = (tablas[tabla] ??= [])
        if (mutacion.op === "insert") {
          const nuevas = (Array.isArray(mutacion.payload) ? mutacion.payload : [mutacion.payload]).map((p: Row) => ({
            id: p.id ?? `${tabla}-${++secuencia}`,
            ...p,
          }))
          for (const fila of nuevas) {
            const err = opciones.antesDeInsertar?.(tabla, fila, tablas)
            if (err) return { data: null, error: err }
          }
          t.push(...nuevas)
          return { data: devolver ? nuevas.map(proyectar) : null, error: null }
        }
        const afectadas = t.filter((r) => filtros.every((f) => f(r)))
        if (mutacion.op === "update") {
          for (const r of afectadas) Object.assign(r, mutacion.payload)
          return { data: devolver ? afectadas.map(proyectar) : null, error: null }
        }
        tablas[tabla] = t.filter((r) => !afectadas.includes(r))
        return { data: null, error: null }
      }

      let rs = filas().filter((r) => filtros.every((f) => f(r)))
      if (ordenes.length) {
        rs = [...rs].sort((a, b) => {
          for (const { col, asc } of ordenes) {
            const c = String(a[col] ?? "").localeCompare(String(b[col] ?? ""))
            if (c !== 0) return asc ? c : -c
          }
          return 0
        })
      }
      const total = rs.length
      if (rango) rs = rs.slice(rango[0], rango[1] + 1)
      if (limite !== null) rs = rs.slice(0, limite)
      if (head) return { data: null, error: null, count: conCount ? total : null }
      return { data: rs.map(proyectar), error: null, count: conCount ? total : null }
    }

    const lista = (data: any): Row[] => (Array.isArray(data) ? data : data == null ? [] : [data])
    q.single = async () => {
      const r = ejecutar()
      if (r.error) return r
      const l = lista(r.data)
      return l.length === 1 ? { data: l[0], error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } }
    }
    q.maybeSingle = async () => {
      const r = ejecutar()
      if (r.error) return r
      return { data: lista(r.data)[0] ?? null, error: null }
    }
    q.then = (ok: (v: any) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(ejecutar()).then(ok, ko)
    return q
  }

  vi.mocked(supabaseAdmin.from).mockImplementation(((t: string) => from(t)) as any)
  return { tablas, escrituras }
}
