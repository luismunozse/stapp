/**
 * An in-memory table that answers a Supabase query the way PostgREST would, so a
 * route that builds the wrong filter returns the wrong rows (a `createChainMock`
 * ignores every filter and so gives a false green on anything about scope).
 *
 * Honoured: select (column projection, `alias:col`, embeds kept by alias), eq, neq, in, is,
 * ilike, gt/gte/lt/lte, `or(...)` with nested and(...)/or(...) (each `.or()` call ANDs with the
 * others, like repeated `or` params), order, range, limit, single, maybeSingle.
 * A filter on `embed.column` follows PostgREST: with `embed!inner(..)` in the select a parent row
 * without a matching embedded row is dropped; without `!inner` every parent is kept and only the
 * embedded rows are filtered (a to-one embed that fails comes back null, a to-many array is
 * filtered); an embed the select does not embed is an error. An `or()` list cannot name an embedded
 * column (the logic-tree parser takes plain columns only), and the `search_vector` full-text
 * operator (`fts`) is not supported either.
 * Anything else throws instead of silently matching, so a new filter in a route cannot
 * slip through unverified. Like PostgREST, a `.single()` / `.maybeSingle()` over several rows is an
 * error, a logic-tree list is parsed with PostgREST's own rules (an unquoted value runs to the next
 * `,` or `)`, so a `)` inside one is a syntax error and a lone `(` is just a character), and a
 * filter, order or select on a column that none of the fixture rows has throws (it would otherwise
 * read as NULL for every row; an empty table cannot be judged).
 */
type Fila = Record<string, any>

/** Splits a select list on its top-level commas (not the ones inside parens or quotes). */
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

type Nodo =
  | { tipo: "logica"; op: "and" | "or"; hijos: Nodo[] }
  | { tipo: "condicion"; col: string; op: string; valor: string }

/**
 * Parses the list inside `or=(...)` the way PostgREST does: items separated by `,`; an item is
 * `and(...)` / `or(...)` or `col.op.value`; a value is double-quoted (backslash escapes), an
 * `in.(a,b)` list, or unquoted, which runs up to the next `,` or `)`. Whatever does not fit is a
 * syntax error.
 */
function parsearLista(texto: string): Nodo[] {
  let i = 0
  const error = (que: string) => new Error(`postgrest-memoria: syntax error (${que}) at ${i} in "${texto}"`)

  function lista(dentroDeGrupo: boolean): Nodo[] {
    const nodos: Nodo[] = []
    for (;;) {
      nodos.push(item())
      if (texto[i] === ",") {
        i++
        continue
      }
      if (dentroDeGrupo && texto[i] === ")") {
        i++
        return nodos
      }
      if (!dentroDeGrupo && i === texto.length) return nodos
      throw error(dentroDeGrupo ? "expected , or )" : "expected , or the end")
    }
  }

  function item(): Nodo {
    const grupo = /^(and|or)\(/.exec(texto.slice(i))
    if (grupo) {
      i += grupo[0].length
      return { tipo: "logica", op: grupo[1] as "and" | "or", hijos: lista(true) }
    }
    const cabeza = /^([^.,()]+)\.([a-z]+)\./.exec(texto.slice(i))
    if (!cabeza) throw error("expected column.operator.value")
    i += cabeza[0].length
    const [, col, op] = cabeza
    let valor: string
    if (texto[i] === '"') {
      let j = i + 1
      valor = ""
      while (j < texto.length && texto[j] !== '"') {
        if (texto[j] === "\\") j++
        valor += texto[j] ?? ""
        j++
      }
      if (texto[j] !== '"') throw error("unterminated quoted value")
      i = j + 1
    } else if (op === "in") {
      if (texto[i] !== "(") throw error("expected ( after in.")
      const fin = texto.indexOf(")", i)
      if (fin < 0) throw error("unterminated in list")
      valor = texto.slice(i, fin + 1)
      i = fin + 1
    } else {
      let j = i
      while (j < texto.length && texto[j] !== "," && texto[j] !== ")") j++
      valor = texto.slice(i, j)
      i = j
    }
    return { tipo: "condicion", col, op, valor }
  }

  return lista(false)
}

function columnasDeLaLista(nodos: Nodo[]): string[] {
  return nodos.flatMap((n) => (n.tipo === "logica" ? columnasDeLaLista(n.hijos) : [n.col]))
}

function cumple(fila: Fila, nodo: Nodo): boolean {
  if (nodo.tipo === "logica") {
    return nodo.op === "and" ? nodo.hijos.every((h) => cumple(fila, h)) : nodo.hijos.some((h) => cumple(fila, h))
  }
  const { col, op, valor } = nodo
  const actual = leer(fila, col)
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
      throw new Error(`postgrest-memoria: operator "${op}" is not supported (in "${col}.${op}.${valor}")`)
  }
}

/** A column of a fixture row, or `embed.column` for a column of an embedded row (an object under the embed's name). */
function leer(fila: Fila, columna: string): any {
  if (!columna.includes(".")) return fila[columna]
  let actual: any = fila
  for (const parte of columna.split(".")) {
    if (actual === null || actual === undefined) return undefined
    actual = actual[parte]
  }
  return actual
}

/** The rows an embed path reaches from a row: an embed is an object (to-one), an array (to-many) or null. */
function embebidas(fila: Fila, ruta: string[]): Fila[] {
  let actuales: Fila[] = [fila]
  for (const parte of ruta) {
    actuales = actuales.flatMap((a) => {
      const valor = a?.[parte]
      return valor === null || valor === undefined ? [] : Array.isArray(valor) ? valor : [valor]
    })
  }
  return actuales
}

/** True when some fixture row has the column, or an embedded row of `embed.column` that has it. */
function existeEnLasFilas(filas: Fila[], columna: string): boolean {
  const partes = columna.split(".")
  const col = partes[partes.length - 1]
  const ruta = partes.slice(0, -1)
  return filas.some((f) => embebidas(f, ruta).some((e) => e !== null && typeof e === "object" && col in e))
}

/**
 * The embeds of a select list as dotted paths, and which of them carry `!inner`
 * (`tabla!inner(..)`, `alias:tabla!fk!inner(..)`). A filter on an embed uses the embed's name (its alias).
 */
function embedsDelSelect(columnas: string, prefijo = "", salida = { todos: new Set<string>(), interiores: new Set<string>() }) {
  for (const item of partirNivel(columnas)) {
    const abre = item.indexOf("(")
    if (abre < 0) continue
    const [nombreCompleto, ...pistas] = item.slice(0, abre).trim().split("!")
    const nombre = (nombreCompleto.includes(":") ? nombreCompleto.split(":")[0] : nombreCompleto).trim()
    const ruta = prefijo ? `${prefijo}.${nombre}` : nombre
    salida.todos.add(ruta)
    if (pistas.some((p) => p.trim() === "inner")) salida.interiores.add(ruta)
    embedsDelSelect(item.slice(abre + 1, item.lastIndexOf(")")), ruta, salida)
  }
  return salida
}

/** Keeps, inside a copy of a result row, the embedded rows `prueba` accepts (a to-one embed that fails becomes null). */
function filtrarEmbebidas(fila: Fila, ruta: string[], prueba: (e: Fila) => boolean): void {
  const [cabeza, ...resto] = ruta
  const valor = fila?.[cabeza]
  if (valor === null || valor === undefined) return
  if (resto.length > 0) {
    ;(Array.isArray(valor) ? valor : [valor]).forEach((e) => filtrarEmbebidas(e, resto, prueba))
  } else if (Array.isArray(valor)) {
    fila[cabeza] = valor.filter(prueba)
  } else if (!prueba(valor)) {
    fila[cabeza] = null
  }
}

/** What `.or(lista)` means: at least one item of the list matches. */
export function cumpleOr(fila: Fila, lista: string): boolean {
  return parsearLista(lista).some((n) => cumple(fila, n))
}

/** `alias:col` → { alias, col }; a plain `col` is its own alias. */
function columnaConAlias(item: string): { alias: string; col: string } {
  const i = item.indexOf(":")
  return i < 0 ? { alias: item, col: item } : { alias: item.slice(0, i).trim(), col: item.slice(i + 1).trim() }
}

function proyectar(fila: Fila, columnas: string): Fila {
  if (columnas.trim() === "*" || columnas.trim() === "") return { ...fila }
  const salida: Fila = {}
  for (const item of partirNivel(columnas)) {
    if (item === "*") Object.assign(salida, fila)
    else if (item.includes("(")) {
      const nombre = item.split("(")[0].split("!")[0].trim()
      const alias = nombre.includes(":") ? nombre.split(":")[0] : nombre
      if (alias in fila) salida[alias] = fila[alias]
    } else {
      const { alias, col } = columnaConAlias(item)
      if (col in fila) salida[alias] = fila[col]
    }
  }
  return salida
}

export function tablaPostgrest(filas: Fila[]) {
  const consultas: Array<{ columnas: string; or: string[] }> = []
  const conocidas = new Set(filas.flatMap((f) => Object.keys(f)))
  const exigir = (columna: string) => {
    if (filas.length > 0 && !existeEnLasFilas(filas, columna)) {
      throw new Error(`postgrest-memoria: column "${columna}" is not in the fixture rows (known: ${[...conocidas].join(", ")})`)
    }
  }
  return {
    consultas,
    select: (columnas = "*", opciones?: { count?: string }) => {
      for (const item of partirNivel(columnas)) if (item !== "*" && !item.includes("(")) exigir(columnaConAlias(item).col)
      const consulta = { columnas, or: [] as string[] }
      consultas.push(consulta)
      const predicados: Array<(f: Fila) => boolean> = []
      // Filters on a NON-inner embed: PostgREST filters the embedded rows and keeps every parent row.
      const sobreEmbebidas: Array<{ ruta: string[]; prueba: (e: Fila) => boolean }> = []
      const embeds = embedsDelSelect(columnas)
      const orden: Array<{ col: string; asc: boolean }> = []
      let rango: [number, number] | null = null

      /**
       * A filter on `column` (`embed.column` for an embedded table). With `embed!inner(..)` in the select
       * a parent row without a matching embedded row is dropped (an inner join); without `!inner` only the
       * embedded rows are filtered, as PostgREST does, so a route that forgot `!inner` returns the parents
       * it should have dropped and its test fails.
       */
      const filtrar = (c: string, prueba: (valor: any) => boolean) => {
        exigir(c)
        if (!c.includes(".")) {
          predicados.push((f) => prueba(f[c]))
          return q
        }
        const partes = c.split(".")
        const col = partes[partes.length - 1]
        const ruta = partes.slice(0, -1)
        const nombre = ruta.join(".")
        if (!embeds.todos.has(nombre)) {
          throw new Error(`postgrest-memoria: "${c}" filters the embed "${nombre}", which the select list does not embed (${columnas})`)
        }
        const probar = (e: Fila) => prueba(e?.[col])
        if (embeds.interiores.has(nombre)) predicados.push((f) => embebidas(f, ruta).some(probar))
        else sobreEmbebidas.push({ ruta, prueba: probar })
        return q
      }

      const q: any = {
        eq: (c: string, v: unknown) => filtrar(c, (valor) => valor === v),
        neq: (c: string, v: unknown) => filtrar(c, (valor) => valor !== v),
        in: (c: string, vs: unknown[]) => filtrar(c, (valor) => vs.includes(valor)),
        is: (c: string, v: unknown) => filtrar(c, (valor) => (v === null ? valor == null : valor === v)),
        ilike: (c: string, p: string) => filtrar(c, (valor) => typeof valor === "string" && aRegex(p).test(valor)),
        gt: (c: string, v: unknown) => filtrar(c, (valor) => comparar(valor, v) > 0),
        gte: (c: string, v: unknown) => filtrar(c, (valor) => comparar(valor, v) >= 0),
        lt: (c: string, v: unknown) => filtrar(c, (valor) => comparar(valor, v) < 0),
        lte: (c: string, v: unknown) => filtrar(c, (valor) => comparar(valor, v) <= 0),
        // not(column, operator, value): the negation of the condition an or() list would hold.
        not: (c: string, op: string, v: unknown) => {
          const col = c.split(".").pop()!
          const condicion: Nodo = { tipo: "condicion", col, op, valor: String(v) }
          return filtrar(c, (valor) => !cumple({ [col]: valor }, condicion))
        },
        or: (lista: string) => {
          const arbol = parsearLista(lista)
          columnasDeLaLista(arbol).forEach(exigir)
          consulta.or.push(lista)
          predicados.push((f) => arbol.some((n) => cumple(f, n)))
          return q
        },
        order: (col: string, o?: { ascending?: boolean }) => (exigir(col), orden.push({ col, asc: o?.ascending !== false }), q),
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
        const proyectadas = rows.map((f) => {
          const fila = proyectar(f, columnas)
          if (sobreEmbebidas.length === 0) return fila
          // The embedded rows are the fixture's own: filter a copy, never the fixture.
          const copia = JSON.parse(JSON.stringify(fila)) as Fila
          sobreEmbebidas.forEach(({ ruta, prueba }) => filtrarEmbebidas(copia, ruta, prueba))
          return copia
        })
        return { rows: proyectadas, total }
      }
      // PostgREST answers PGRST116 when .single() finds zero or several rows, and when
      // .maybeSingle() finds several.
      q.single = async () => {
        const { rows } = resolver()
        return rows.length === 1
          ? { data: rows[0], error: null }
          : { data: null, error: { code: "PGRST116", message: `${rows.length} rows, expected 1` } }
      }
      q.maybeSingle = async () => {
        const { rows } = resolver()
        if (rows.length > 1) return { data: null, error: { code: "PGRST116", message: `${rows.length} rows, expected at most 1` } }
        return { data: rows[0] ?? null, error: null }
      }
      q.then = (res: any, rej?: any) => {
        const { rows, total } = resolver()
        return Promise.resolve({ data: rows, error: null, ...(opciones?.count ? { count: total } : {}) }).then(res, rej)
      }
      return q
    },
  }
}
