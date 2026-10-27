/**
 * An in-memory table that answers a Supabase query the way PostgREST would, so a
 * route that builds the wrong filter returns the wrong rows (a `createChainMock`
 * ignores every filter and so gives a false green on anything about scope).
 *
 * Honoured: select (column projection, embeds kept by alias), eq, neq, in, is, ilike,
 * gt/gte/lt/lte, `or(...)` with nested and(...)/or(...) (each `.or()` call ANDs with the
 * others, like repeated `or` params), order, range, limit, single, maybeSingle.
 * Anything else throws instead of silently matching, so a new filter in a route cannot
 * slip through unverified.
 */
type Fila = Record<string, any>

/** Splits a PostgREST list on its top-level commas (not the ones inside parens or quotes). */
function partirNivel(texto: string): string[] {
  const partes: string[] = []
  let nivel = 0
  let comillas = false
  let actual = ""
  for (const c of texto) {
    if (c === '"') comillas = !comillas
    if (!comillas && c === "(") nivel++
    if (!comillas && c === ")") nivel--
    if (!comillas && nivel === 0 && c === ",") {
      partes.push(actual)
      actual = ""
    } else {
      actual += c
    }
  }
  if (actual !== "") partes.push(actual)
  return partes.map((p) => p.trim()).filter((p) => p !== "")
}

function comparar(a: unknown, b: unknown): number {
  const na = Number(a)
  const nb = Number(b)
  if (a !== null && b !== null && a !== "" && b !== "" && !Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
  return String(a).localeCompare(String(b))
}

function aRegex(patron: string): RegExp {
  const escapado = patron.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/[%*]/g, ".*").replace(/_/g, ".")
  return new RegExp(`^${escapado}$`, "i")
}

function condicion(fila: Fila, item: string): boolean {
  const i1 = item.indexOf(".")
  const i2 = item.indexOf(".", i1 + 1)
  const col = item.slice(0, i1)
  const op = item.slice(i1 + 1, i2)
  const valor = item.slice(i2 + 1).replace(/^"(.*)"$/, "$1")
  const actual = fila[col]
  switch (op) {
    case "eq":
      return actual !== null && actual !== undefined && String(actual) === valor
    case "neq":
      return String(actual) !== valor
    case "is":
      return valor === "null" ? actual === null || actual === undefined : String(actual) === valor
    case "in":
      return partirNivel(valor.replace(/^\(|\)$/g, "")).includes(String(actual))
    case "ilike":
      return typeof actual === "string" && aRegex(valor).test(actual)
    case "gt":
      return comparar(actual, valor) > 0
    case "gte":
      return comparar(actual, valor) >= 0
    case "lt":
      return comparar(actual, valor) < 0
    case "lte":
      return comparar(actual, valor) <= 0
    default:
      throw new Error(`postgrest-memoria: operator "${op}" is not supported (in "${item}")`)
  }
}

function evaluar(fila: Fila, item: string): boolean {
  const logica = item.match(/^(and|or)\(([\s\S]*)\)$/)
  if (!logica) return condicion(fila, item)
  const hijos = partirNivel(logica[2])
  return logica[1] === "and" ? hijos.every((h) => evaluar(fila, h)) : hijos.some((h) => evaluar(fila, h))
}

/** What `.or(lista)` means: at least one item of the list matches. */
export function cumpleOr(fila: Fila, lista: string): boolean {
  return partirNivel(lista).some((item) => evaluar(fila, item))
}

function proyectar(fila: Fila, columnas: string): Fila {
  if (columnas.trim() === "*" || columnas.trim() === "") return { ...fila }
  const salida: Fila = {}
  for (const item of partirNivel(columnas)) {
    if (item === "*") Object.assign(salida, fila)
    else if (item.includes("(")) {
      const nombre = item.split("(")[0].split("!")[0]
      const alias = nombre.includes(":") ? nombre.split(":")[0] : nombre
      if (alias in fila) salida[alias] = fila[alias]
    } else if (item in fila) salida[item] = fila[item]
  }
  return salida
}

export function tablaPostgrest(filas: Fila[]) {
  const consultas: Array<{ columnas: string; or: string[] }> = []
  return {
    consultas,
    select: (columnas = "*", opciones?: { count?: string }) => {
      const consulta = { columnas, or: [] as string[] }
      consultas.push(consulta)
      const predicados: Array<(f: Fila) => boolean> = []
      const orden: Array<{ col: string; asc: boolean }> = []
      let rango: [number, number] | null = null
      const q: any = {
        eq: (c: string, v: unknown) => (predicados.push((f) => f[c] === v), q),
        neq: (c: string, v: unknown) => (predicados.push((f) => f[c] !== v), q),
        in: (c: string, vs: unknown[]) => (predicados.push((f) => vs.includes(f[c])), q),
        is: (c: string, v: unknown) => (predicados.push((f) => (v === null ? f[c] == null : f[c] === v)), q),
        ilike: (c: string, p: string) => (predicados.push((f) => typeof f[c] === "string" && aRegex(p).test(f[c])), q),
        gt: (c: string, v: unknown) => (predicados.push((f) => comparar(f[c], v) > 0), q),
        gte: (c: string, v: unknown) => (predicados.push((f) => comparar(f[c], v) >= 0), q),
        lt: (c: string, v: unknown) => (predicados.push((f) => comparar(f[c], v) < 0), q),
        lte: (c: string, v: unknown) => (predicados.push((f) => comparar(f[c], v) <= 0), q),
        or: (lista: string) => (consulta.or.push(lista), predicados.push((f) => cumpleOr(f, lista)), q),
        order: (col: string, o?: { ascending?: boolean }) => (orden.push({ col, asc: o?.ascending !== false }), q),
        range: (desde: number, hasta: number) => ((rango = [desde, hasta]), q),
        limit: (n: number) => ((rango = [0, n - 1]), q),
        abortSignal: () => q,
      }
      const resolver = () => {
        let rows = filas.filter((f) => predicados.every((p) => p(f)))
        for (const { col, asc } of [...orden].reverse()) {
          rows = [...rows].sort((a, b) => {
            const r = comparar(a[col], b[col])
            return asc ? r : -r
          })
        }
        const total = rows.length
        if (rango) rows = rows.slice(rango[0], rango[1] + 1)
        return { rows: rows.map((f) => proyectar(f, columnas)), total }
      }
      q.single = async () => {
        const { rows } = resolver()
        return rows[0] ? { data: rows[0], error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } }
      }
      q.maybeSingle = async () => ({ data: resolver().rows[0] ?? null, error: null })
      q.then = (res: any, rej?: any) => {
        const { rows, total } = resolver()
        return Promise.resolve({ data: rows, error: null, ...(opciones?.count ? { count: total } : {}) }).then(res, rej)
      }
      return q
    },
  }
}
