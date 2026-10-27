/**
 * An in-memory `supabaseAdmin` for the tests that must prove a request touched NOTHING.
 *
 * Reads answer like PostgREST (`tablaPostgrest`: the filters are honoured, so a route that scopes
 * wrongly returns the wrong rows; a `createChainMock` ignores every filter and gives a false green
 * on anything about scope). Every write (`insert`, `update`, `upsert`, `delete`, `rpc`) is recorded
 * in `escrituras` and answered with its own payload, so a test can assert `escrituras` is empty
 * for a request that must be refused, and see exactly what an allowed one wrote.
 *
 * A table that was not given answers like an empty one. `lecturas` lists the tables read, in
 * order, for the tests that care about which lookups happen at all.
 */
import { vi } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { tablaPostgrest } from "./postgrest-memoria"

type Fila = Record<string, any>

export interface Escritura {
  tabla: string
  operacion: "insert" | "update" | "upsert" | "delete" | "rpc"
  carga?: unknown
}

interface Opciones {
  /** What a write answers with (`.select().single()` after an update). Defaults to its own payload. */
  resultadoEscritura?: (escritura: Escritura) => unknown
}

const ESCRITURAS = ["insert", "update", "upsert", "delete"] as const

/** A chain whose every filter returns itself and that ends in `{ data, error: null }`. */
function cadenaDeEscritura(resultado: unknown) {
  const respuesta = { data: resultado, error: null }
  const cadena: any = {}
  for (const metodo of ["eq", "neq", "is", "in", "not", "or", "select", "order", "limit", "range"]) {
    cadena[metodo] = () => cadena
  }
  cadena.single = async () => respuesta
  cadena.maybeSingle = async () => respuesta
  cadena.then = (resolver: any, rechazar?: any) => Promise.resolve(respuesta).then(resolver, rechazar)
  return cadena
}

export function montarSupabaseEnMemoria(tablas: Record<string, Fila[]>, opciones: Opciones = {}) {
  const escrituras: Escritura[] = []
  const lecturas: string[] = []
  const memoria = new Map<string, ReturnType<typeof tablaPostgrest>>(
    Object.entries(tablas).map(([nombre, filas]) => [nombre, tablaPostgrest(filas)]),
  )
  const tabla = (nombre: string) => {
    if (!memoria.has(nombre)) memoria.set(nombre, tablaPostgrest([]))
    return memoria.get(nombre)!
  }
  const registrar = (e: Escritura) => {
    escrituras.push(e)
    return opciones.resultadoEscritura ? opciones.resultadoEscritura(e) : (e.carga ?? null)
  }

  vi.mocked(supabaseAdmin.from).mockImplementation(((nombre: string) => {
    const lectura = tabla(nombre)
    const escritura = Object.fromEntries(
      ESCRITURAS.map((operacion) => [
        operacion,
        (carga?: unknown) => cadenaDeEscritura(registrar({ tabla: nombre, operacion, carga })),
      ]),
    )
    return {
      select: (...args: Parameters<typeof lectura.select>) => {
        lecturas.push(nombre)
        return lectura.select(...args)
      },
      ...escritura,
    }
  }) as any)

  vi.mocked(supabaseAdmin.rpc).mockImplementation((async (nombre: string, carga?: unknown) => {
    const resultado = registrar({ tabla: nombre, operacion: "rpc", carga })
    return { data: resultado, error: null }
  }) as any)

  return {
    escrituras,
    lecturas,
    /** The SELECT strings the table received, in order. */
    consultas: (nombre: string) => tabla(nombre).consultas.map((c) => c.columnas),
  }
}
