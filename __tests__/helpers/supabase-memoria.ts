/**
 * An in-memory `supabaseAdmin` for the tests that must prove a request touched NOTHING.
 *
 * Reads answer like PostgREST (`tablaPostgrest`: the filters are honoured, so a route that scopes
 * wrongly returns the wrong rows; a `createChainMock` ignores every filter and gives a false green
 * on anything about scope).
 *
 * Writes are applied to the tables, with the filters chained onto them (`eq`, `neq`, `is`, `in`;
 * any other filter is an error, never a silent match), and recorded in `escrituras` together with
 * those filters. A route that drops `.eq("id", ...)` from its UPDATE or DELETE therefore changes
 * every row of the organization, and the test sees both the missing filter and the wrong table.
 * `insert`, `update`, `upsert`, `delete`, `rpc`, every `storage` call and every `auth` call are
 * recorded, so a test can assert `escrituras` is empty for a request that must be refused.
 *
 * A table that was not given answers like an empty one. `lecturas` lists the tables read, in order,
 * for the tests that care about which lookups happen at all. The fixtures are copied: a test never
 * changes the rows it passed in.
 */
import { vi } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { tablaPostgrest } from "./postgrest-memoria"

type Fila = Record<string, any>
type Filtro = [string, ...unknown[]]

export interface Escritura {
  /** The table, the rpc name, `storage:<bucket>` or `auth`. */
  tabla: string
  operacion: "insert" | "update" | "upsert" | "delete" | "rpc" | "storage" | "auth"
  carga?: unknown
  /** The filters chained onto the write, in order: `[method, ...args]`. */
  filtros: Filtro[]
}

interface Opciones {
  /** Makes every read of a table fail with this error (a database that answers, but with an error). */
  errorDeLectura?: Record<string, { code?: string; message: string }>
  /** What an rpc answers with. Defaults to `{ success: true }`. */
  resultadoRpc?: (nombre: string, args: unknown) => unknown
}

const copia = <T>(valor: T): T => JSON.parse(JSON.stringify(valor))

const ESCRITURAS = ["insert", "update", "upsert", "delete"] as const
const FILTROS_DE_ESCRITURA = ["eq", "neq", "is", "in"]
const SIN_EFECTO_EN_ESCRITURA = ["order", "limit", "range", "abortSignal"]

const SIN_FILA = { code: "PGRST116", message: "0 rows, expected 1" }

/** A function-valued proxy that records every call made through any path under it. */
function espia(ruta: string[], registrar: (ruta: string, args: unknown[]) => unknown): any {
  return new Proxy(function () {}, {
    get: (_destino, propiedad) => (propiedad === "then" || typeof propiedad === "symbol" ? undefined : espia([...ruta, propiedad], registrar)),
    apply: (_destino, _este, args) => registrar(ruta.join("."), args),
  })
}

export function montarSupabaseEnMemoria(tablas: Record<string, Fila[]>, opciones: Opciones = {}) {
  const escrituras: Escritura[] = []
  const lecturas: string[] = []

  const filasDe = new Map<string, Fila[]>()
  const columnas = new Map<string, Set<string>>()
  const memoria = new Map<string, ReturnType<typeof tablaPostgrest>>()
  const tabla = (nombre: string) => {
    if (!memoria.has(nombre)) {
      const filas = copia(tablas[nombre] ?? [])
      filasDe.set(nombre, filas)
      columnas.set(nombre, new Set(filas.flatMap((f) => Object.keys(f))))
      memoria.set(nombre, tablaPostgrest(filas))
    }
    return memoria.get(nombre)!
  }
  Object.keys(tablas).forEach(tabla)

  const exigirColumna = (nombre: string, columna: string) => {
    const filas = filasDe.get(nombre)!
    if (filas.length > 0 && !columnas.get(nombre)!.has(columna)) {
      throw new Error(`supabase-memoria: column "${columna}" is not in the fixture rows of "${nombre}"`)
    }
  }

  const coincide = (fila: Fila, [metodo, columna, valor]: Filtro): boolean => {
    const actual = fila[columna as string]
    if (metodo === "eq") return actual === valor
    if (metodo === "neq") return actual !== valor
    if (metodo === "is") return valor === null ? actual == null : actual === valor
    return (valor as unknown[]).includes(actual)
  }

  /** The chain of a write: filters are validated when chained and applied when the write is awaited. */
  function cadenaDeEscritura(nombre: string, operacion: (typeof ESCRITURAS)[number], carga: unknown) {
    const escritura: Escritura = { tabla: nombre, operacion, carga, filtros: [] }
    escrituras.push(escritura)
    tabla(nombre)
    let seleccionada = false
    let ejecutada: Fila[] | null = null

    const ejecutar = (): Fila[] => {
      if (ejecutada) return ejecutada
      const filas = filasDe.get(nombre)!
      if (operacion === "insert" || operacion === "upsert") {
        const nuevas = (Array.isArray(carga) ? carga : [carga]).map((f) => copia(f as Fila))
        filas.push(...nuevas)
        ejecutada = nuevas
      } else {
        const alcanzadas = filas.filter((f) => escritura.filtros.every((filtro) => coincide(f, filtro)))
        if (operacion === "update") alcanzadas.forEach((f) => Object.assign(f, copia(carga as Fila)))
        else alcanzadas.forEach((f) => filas.splice(filas.indexOf(f), 1))
        ejecutada = alcanzadas
      }
      return ejecutada
    }

    const respuestaDeLista = () => ({ data: seleccionada ? copia(ejecutar()) : (ejecutar(), null), error: null })
    const cadena: any = {}
    for (const metodo of [...FILTROS_DE_ESCRITURA, ...SIN_EFECTO_EN_ESCRITURA, "select", "not", "or", "ilike", "gt", "gte", "lt", "lte"]) {
      cadena[metodo] = (...args: unknown[]) => {
        if (metodo === "select") {
          seleccionada = true
        } else if (FILTROS_DE_ESCRITURA.includes(metodo)) {
          exigirColumna(nombre, args[0] as string)
          escritura.filtros.push([metodo, ...args])
        } else if (!SIN_EFECTO_EN_ESCRITURA.includes(metodo)) {
          throw new Error(`supabase-memoria: ${metodo} is not supported on a write (table "${nombre}")`)
        }
        return cadena
      }
    }
    cadena.single = async () => {
      seleccionada = true
      const filas = ejecutar()
      return filas.length === 1 ? { data: copia(filas[0]), error: null } : { data: null, error: SIN_FILA }
    }
    cadena.maybeSingle = async () => {
      seleccionada = true
      const filas = ejecutar()
      if (filas.length > 1) return { data: null, error: { code: "PGRST116", message: `${filas.length} rows, expected at most 1` } }
      return { data: filas.length === 1 ? copia(filas[0]) : null, error: null }
    }
    cadena.then = (resolver: any, rechazar?: any) => Promise.resolve(respuestaDeLista()).then(resolver, rechazar)
    cadena.catch = (rechazar: any) => Promise.resolve(respuestaDeLista()).catch(rechazar)
    return cadena
  }

  /** A read that fails: filters chain as usual and every way of awaiting it answers the error. */
  function lecturaConError(error: { code?: string; message: string }) {
    const respuesta = { data: null, error }
    const cadena: any = {}
    for (const metodo of ["select", "eq", "neq", "in", "is", "not", "or", "ilike", "gt", "gte", "lt", "lte", "order", "limit", "range", "abortSignal"]) {
      cadena[metodo] = () => cadena
    }
    cadena.single = async () => respuesta
    cadena.maybeSingle = async () => respuesta
    cadena.then = (resolver: any, rechazar?: any) => Promise.resolve(respuesta).then(resolver, rechazar)
    return cadena
  }

  vi.mocked(supabaseAdmin.from).mockImplementation(((nombre: string) => {
    const lectura = tabla(nombre)
    return {
      select: (...args: Parameters<typeof lectura.select>) => {
        lecturas.push(nombre)
        const error = opciones.errorDeLectura?.[nombre]
        return error ? lecturaConError(error) : lectura.select(...args)
      },
      ...Object.fromEntries(ESCRITURAS.map((operacion) => [operacion, (carga?: unknown) => cadenaDeEscritura(nombre, operacion, carga)])),
    }
  }) as any)

  vi.mocked(supabaseAdmin.rpc).mockImplementation((async (nombre: string, args?: unknown) => {
    escrituras.push({ tabla: nombre, operacion: "rpc", carga: args, filtros: [] })
    return { data: opciones.resultadoRpc ? opciones.resultadoRpc(nombre, args) : { success: true }, error: null }
  }) as any)

  // Storage and auth are not tables, but a refused request must not reach them either.
  vi.mocked((supabaseAdmin as any).storage.from).mockImplementation(((bucket: string) =>
    espia([], (metodo, args) => {
      escrituras.push({ tabla: `storage:${bucket}`, operacion: "storage", carga: { metodo, args }, filtros: [] })
      return metodo === "getPublicUrl"
        ? { data: { publicUrl: `https://storage.invalid/${bucket}` } }
        : Promise.resolve({ data: metodo === "list" ? [] : null, error: null })
    })) as any)
  ;(supabaseAdmin as any).auth = espia([], (metodo, args) => {
    escrituras.push({ tabla: "auth", operacion: "auth", carga: { metodo, args }, filtros: [] })
    return Promise.resolve({ data: null, error: null })
  })

  return {
    escrituras,
    lecturas,
    /** The rows a table holds now (writes included). */
    filas: (nombre: string): Fila[] => (tabla(nombre), filasDe.get(nombre)!),
    /** The SELECT strings the table received, in order. */
    consultas: (nombre: string) => tabla(nombre).consultas.map((c) => c.columnas),
    /** The `.or()` lists each query of the table received, in order (one inner array per query). */
    listasOr: (nombre: string) => tabla(nombre).consultas.map((c) => c.or),
  }
}
