import { vi } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * Fake de PostgREST para los tests de crons.
 *
 * A diferencia de createChainMock (que ignora columnas y filtros), este fake se
 * comporta como la base real en los puntos donde un mock ciego da falsos verdes:
 *  - una columna inexistente en select/filtro/orden devuelve
 *    `{ data: null, error: { code: "42703" } }` (supabase-js no tira excepcion),
 *  - los filtros gte/lte/eq/in/is se aplican sobre las filas del fixture,
 *  - los resultados se truncan a 1000 filas (max_rows de PostgREST).
 *
 * Solo `ordenes_servicio` tiene lista de columnas (la tabla que no tiene
 * created_at/updated_at). El resto de las tablas acepta cualquier columna.
 */

type Row = Record<string, unknown>

// Columnas reales de ordenes_servicio en prod (information_schema, 2026-10-09).
// Notar: NO existen created_at ni updated_at.
export const ORDENES_SERVICIO_COLUMNS = new Set(
  (
    "id,numero_orden,cliente_id,tecnico_id,organization_id,dispositivo,tipo_dispositivo,problema_reportado,estado," +
    "presupuesto,costo_final,fecha_ingreso,fecha_prometida,fecha_completado,observaciones,diagnostico,marca,color,imei," +
    "accesorios,password_dispositivo,public_token,sena,codigo_orden,fecha_entrega,firma_cliente_entrega," +
    "firma_cliente_entrega_mime,firma_encargado_entrega,firma_encargado_entrega_mime,entregado_por_user_id,notas_entrega," +
    "firma_cliente_recepcion,firma_cliente_recepcion_mime,tipo_dispositivo_id,search_vector,presupuesto_aprobado_portal," +
    "presupuesto_firma_url,presupuesto_firma_path,presupuesto_fecha_aprobacion,metadata,sector_id,metodo_pago_sena," +
    "total_cobrado,estado_cobro,descuento_cobro,public_token_expires_at,orden_origen_id,es_reingreso,garantia_origen_id," +
    "telefono_contacto,porcentaje_comision,comision_pagada,fecha_pago_comision,comision_pago_notas,motivo_sin_cobro," +
    "notas_internas,sucursal_id,horas_trabajadas,costo_hora_snapshot,costo_mano_obra,recibido_por,recepcion_id," +
    "comision_pago_movimiento_id"
  ).split(",")
)

const TABLE_COLUMNS: Record<string, Set<string>> = {
  ordenes_servicio: ORDENES_SERVICIO_COLUMNS,
}

const MAX_ROWS = 1000

export type PgError = { code: string; message: string }
export type RecordedQuery = { table: string; ops: Array<{ op: string; args: unknown[] }> }
export type RecordedWrite = { table: string; op: string; payload: unknown }

export type PostgrestFake = {
  queries: RecordedQuery[]
  writes: RecordedWrite[]
  from: (table: string) => unknown
}

export function createPostgrestFake(
  tables: Record<string, Row[]>,
  options: { failTables?: Record<string, PgError> } = {}
): PostgrestFake {
  const queries: RecordedQuery[] = []
  const writes: RecordedWrite[] = []

  function from(table: string) {
    const ops: RecordedQuery["ops"] = []
    queries.push({ table, ops })
    const filters: Array<(r: Row) => boolean> = []
    const usedColumns: string[] = []
    let selectCols: string[] | null = null
    let head = false
    let wantCount = false
    const orders: Array<{ col: string; asc: boolean }> = []
    let limit: number | null = null
    let range: [number, number] | null = null
    let mutation: string | null = null

    const track = (col: unknown) => {
      if (typeof col === "string") usedColumns.push(col)
    }

    const chain: Record<string, unknown> = {}
    const add = (name: string, fn: (...a: any[]) => void) => {
      chain[name] = (...args: unknown[]) => {
        ops.push({ op: name, args })
        fn(...args)
        return chain
      }
    }

    add("select", (cols?: string, opts?: { count?: string; head?: boolean }) => {
      if (mutation) return
      if (typeof cols === "string") {
        selectCols = cols.split(",").map((c) => c.trim()).filter(Boolean)
        selectCols.forEach((c) => {
          if (!/[(:*!]/.test(c)) usedColumns.push(c)
        })
      }
      head = !!opts?.head
      wantCount = !!opts?.count
    })
    add("eq", (c, v) => { track(c); filters.push((r) => r[c] === v) })
    add("neq", (c, v) => { track(c); filters.push((r) => r[c] !== v) })
    add("gte", (c, v) => { track(c); filters.push((r) => r[c] != null && String(r[c]) >= String(v)) })
    add("lte", (c, v) => { track(c); filters.push((r) => r[c] != null && String(r[c]) <= String(v)) })
    add("gt", (c, v) => { track(c); filters.push((r) => r[c] != null && String(r[c]) > String(v)) })
    add("lt", (c, v) => { track(c); filters.push((r) => r[c] != null && String(r[c]) < String(v)) })
    add("in", (c, vs: unknown[]) => { track(c); filters.push((r) => vs.includes(r[c])) })
    add("is", (c, v) => { track(c); filters.push((r) => (v === null ? r[c] == null : r[c] === v)) })
    add("not", (c, op, v) => {
      track(c)
      if (op === "is" && v === null) filters.push((r) => r[c] != null)
    })
    add("like", (c) => { track(c) })
    add("order", (c, o?: { ascending?: boolean }) => { track(c); orders.push({ col: c, asc: o?.ascending !== false }) })
    add("limit", (n) => { limit = n })
    add("range", (from, to) => { range = [from, to] })
    for (const m of ["insert", "update", "upsert", "delete"]) {
      add(m, (payload) => { mutation = m; writes.push({ table, op: m, payload }) })
    }

    const resolve = (): Row => {
      const failure = options.failTables?.[table]
      if (failure) return { data: null, error: failure }

      if (mutation) return { data: [], error: null }

      const known = TABLE_COLUMNS[table]
      if (known) {
        const bad = usedColumns.find((c) => !known.has(c))
        if (bad) {
          return {
            data: null,
            error: { code: "42703", message: `column ${table}.${bad} does not exist` },
          }
        }
      }

      let rows = (tables[table] || []).filter((r) => filters.every((f) => f(r)))
      if (orders.length) {
        rows = [...rows].sort((a, b) => {
          for (const { col, asc } of orders) {
            const c = String(a[col] ?? "").localeCompare(String(b[col] ?? ""))
            if (c !== 0) return asc ? c : -c
          }
          return 0
        })
      }
      const total = rows.length
      if (range) rows = rows.slice(range[0], range[1] + 1)
      if (limit !== null) rows = rows.slice(0, limit)
      rows = rows.slice(0, MAX_ROWS)

      if (head) return { data: null, error: null, count: wantCount ? total : null }
      const data = selectCols
        ? rows.map((r) => {
            const out: Row = {}
            for (const c of selectCols!) if (c in r) out[c] = r[c]
            return out
          })
        : rows
      return { data, error: null, count: wantCount ? total : null }
    }

    chain.single = () => Promise.resolve(resolve())
    chain.maybeSingle = () => Promise.resolve(resolve())
    chain.then = (res: (v: Row) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(resolve()).then(res, rej)
    return chain
  }

  return { queries, writes, from }
}

export function installPostgrestFake(
  tables: Record<string, Row[]>,
  options?: { failTables?: Record<string, PgError> }
): PostgrestFake {
  const fake = createPostgrestFake(tables, options)
  vi.mocked(supabaseAdmin.from).mockImplementation(((t: string) => fake.from(t)) as any)
  return fake
}
