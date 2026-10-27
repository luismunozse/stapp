// @vitest-environment node
/**
 * Sweep (change sucursales-aislamiento, PR5; OI-1, SC-2, XC-1): every read of `ordenes_servicio`
 * either goes through a branch-scope helper or is listed, with its reason, in one of the lists below.
 *
 * On the syntax tree, not on text. A READ is
 *  - a query that starts `.from("ordenes_servicio")` and is not a write, or one whose use cannot be seen;
 *  - a `.select(..)` whose columns EMBED the table (`ordenes_servicio(..)`, `alias:ordenes_servicio(..)`,
 *    `ordenes_servicio!inner(..)`, `ordenes_servicio!fk(..)`, `ordenes_servicio:fk_column(..)`): the
 *    orders reach the caller through another table. A `${NAME}` of a template, or a whole argument, that
 *    names a string constant (of the file, or one another file exports) is written out first, so an embed
 *    assembled from a constant is seen;
 *  - the table NAMED as a string value that is handed to a call (`fetchAllRows("ordenes_servicio", ..)`) or
 *    held in a constant: the query is built somewhere else. An audit entry (`audit.create("ordenes_servicio",
 *    ..)`) names its entity and reads nothing. A table named by a parameter (`.from(tabla)`) cannot be seen:
 *    its callers are the ones swept.
 *
 * A read counts as scoped only when a helper is APPLIED TO THAT read, one helper call per read:
 *  (A) a filter builder (`filtroVisibleEnSucursal`, `filtroAtiendeSucursal`, `filtroListaTecnico`), or, for
 *      an embed, a filter on the embed's `sucursal_id` / `tecnico_id`, sits inside the read's own chain. A
 *      filter on an embed scopes only when the embed is `!inner` (every embed of its path): without it
 *      PostgREST filters the embedded rows and keeps every parent row;
 *  (B) the chain is an argument of a wrapper (`soloAtendidasPor`, `soloOriginadasEn`, the door's
 *      `.aplicar` / `.aplicarAEmbed`). The door's wrappers narrow a plain embed on purpose (the client
 *      detail, the technician counts); `soloOriginadasEn(.., "embed.sucursal_id")` is an `.eq` on the embed
 *      and needs `!inner` like any other filter on it;
 *  (C) the chain is held in a variable that a wrapper (or an embed filter) receives.
 * A select that embeds the table more than once is one read PER embed, and a wrapper that names an embed
 * (`soloAtendidasPorEnEmbed(q, s, "alias")`, `aplicarAEmbed(q, "alias")`) narrows that one: a sibling embed next
 * to a narrowed one (the technicians' open orders of every branch next to the ones of the viewer's scope) is
 * a read of its own, and is listed with its reason.
 * A call that is only in the same function, that wraps another table's query, or that is already spent
 * on another read, covers nothing. `cargarOrdenEnAlcance` is a loader (it reads at its call site) and
 * `alcanceLecturaOrdenes` only hands out the scope: neither covers a query by being called.
 *
 * Only READS are swept. Writes by id are covered by the handler sweep of the order routes
 * (ordenes-subroutes-sweep.test.ts).
 *
 * The lists carry the exact number of loose reads per file, so a stale entry (the file now has fewer, or
 * more) fails too:
 *  - EXENTOS: reads that do not need the helpers, and why.
 *  - PENDIENTE_*: reads that a later change of this series scopes; each such change empties its list.
 */
import { describe, it, expect } from "vitest"
import ts from "typescript"
import { leerFuentes } from "../helpers/fuentes"

/** Calls that take the QUERY and narrow it: a read in their first argument, or held in the variable they receive, is scoped. */
const ENVOLTURAS = ["soloAtendidasPor", "soloAtendidasPorEnEmbed", "soloOriginadasEn", "aplicar", "aplicarAEmbed"]
/** Builders of the filter string a read applies inside its own chain (`.or(filtroX(..))`). */
const FILTROS = ["filtroVisibleEnSucursal", "filtroAtiendeSucursal", "filtroListaTecnico"]
/** Approved but never applied by being called: the order loader reads at its call site, the door factory hands out the scope. */
const SOLO_DEFINIDAS = ["cargarOrdenEnAlcance", "alcanceLecturaOrdenes"]

const ESCRITURAS = ["insert", "update", "upsert", "delete"]
/** A column of an embed that scopes it by branch or by technician. */
const COLUMNAS_DE_ALCANCE = ["sucursal_id", "tecnico_id"]

/** One embed of the orders table in a select list. */
interface EmbedDeOrdenes {
  /** The alias, or the table's own name: how a filter names it. */
  nombre: string
  /** The dotted path of embed names from the queried table (`facturas.ordenes_servicio`). */
  ruta: string
  /** Every embed of the path is `!inner`: only then does a filter on it drop the parent rows. */
  interior: boolean
}

interface Lectura {
  linea: number
  posicion: number
  /** Where the read starts: the `.from(..)` call, the `.select(..)` call of an embed, or the call (or constant) that names the table as a string. */
  desde: ts.Node
  /** The nearest function (or the file) that holds the read. */
  contenedor: ts.Node
  /** The embeds of the table in the read's select; empty for a query that starts on the table. */
  embeds: EmbedDeOrdenes[]
  /** The table is only NAMED as a string value (`fetchAllRows("ordenes_servicio", ..)`, a constant): the query is built elsewhere. */
  esMencion?: boolean
}

/** String constants by name: the ones other files export, so that a `${NAME}` in a select can be followed. */
type Constantes = ReadonlyMap<string, string>

const esFuncion = (n: ts.Node) =>
  ts.isFunctionDeclaration(n) ||
  ts.isFunctionExpression(n) ||
  ts.isArrowFunction(n) ||
  ts.isMethodDeclaration(n) ||
  ts.isGetAccessor(n) ||
  ts.isSetAccessor(n) ||
  ts.isConstructorDeclaration(n)

/** `(x)`, `x as T`, `x!`, `x satisfies T`, `<T>x`, `await x`: the same expression for what this sweep asks. */
function esTransparente(n: ts.Node): n is ts.Node & { expression: ts.Expression } {
  return (
    ts.isParenthesizedExpression(n) ||
    ts.isAsExpression(n) ||
    ts.isNonNullExpression(n) ||
    ts.isSatisfiesExpression(n) ||
    ts.isTypeAssertionExpression(n) ||
    ts.isAwaitExpression(n)
  )
}

function desenvolver(n: ts.Node): ts.Node {
  let actual = n
  while (esTransparente(actual)) actual = actual.expression
  return actual
}

const textoDe = (n: ts.Node): string | null => {
  const base = desenvolver(n)
  return ts.isStringLiteral(base) || ts.isNoSubstitutionTemplateLiteral(base) ? base.text : null
}

const nombreDeLlamada = (n: ts.CallExpression): string | null => {
  const f = n.expression
  return ts.isIdentifier(f) ? f.text : ts.isPropertyAccessExpression(f) ? f.name.text : null
}

/**
 * `audit.create("ordenes_servicio", id, ..)` / `createAuditLogger(..).update("ordenes_servicio", ..)`: an audit
 * entry names the entity it is about; it reads no order.
 */
function esEntradaDeAuditoria(llamada: ts.CallExpression): boolean {
  const f = llamada.expression
  if (!ts.isPropertyAccessExpression(f) || !["create", "update", "delete"].includes(f.name.text)) return false
  const receptor = desenvolver(f.expression)
  return (ts.isIdentifier(receptor) && receptor.text === "audit") || (ts.isCallExpression(receptor) && nombreDeLlamada(receptor) === "createAuditLogger")
}

/** Splits a select list on its top-level commas (not the ones inside parens). */
function partirNivel(texto: string): string[] {
  const partes: string[] = []
  let nivel = 0
  let actual = ""
  for (const c of texto) {
    if (c === "(") nivel++
    if (c === ")") nivel--
    if (nivel === 0 && c === ",") {
      partes.push(actual)
      actual = ""
    } else {
      actual += c
    }
  }
  if (actual.trim() !== "") partes.push(actual)
  return partes.map((p) => p.trim()).filter((p) => p !== "")
}

/** The head of an embed that is the orders table: `ordenes_servicio`, `alias:ordenes_servicio`, with `!hint`s or `:column`. */
const CABEZA_DE_ORDENES = /^(?:(\w+)\s*:\s*)?ordenes_servicio((?:\s*[:!]\s*\w+)*)$/

/**
 * The embeds of `ordenes_servicio` in a select list, with the dotted path of each and whether every embed of
 * the path is `!inner`. A path that appears both ways (a select with two shapes) counts as not inner.
 */
function embedsDeOrdenes(columnas: string): EmbedDeOrdenes[] {
  const encontrados: EmbedDeOrdenes[] = []
  const recorrer = (lista: string, prefijo: string[], interiorHastaAqui: boolean) => {
    for (const item of partirNivel(lista)) {
      const abre = item.indexOf("(")
      if (abre < 0) continue
      const cabeza = item.slice(0, abre).trim()
      const nombre = (cabeza.includes(":") ? cabeza.split(":")[0] : cabeza.split("!")[0]).trim()
      const interior = interiorHastaAqui && /!\s*inner\b/.test(cabeza)
      const ruta = [...prefijo, nombre]
      if (CABEZA_DE_ORDENES.test(cabeza)) encontrados.push({ nombre, ruta: ruta.join("."), interior })
      recorrer(item.slice(abre + 1, item.lastIndexOf(")")), ruta, interior)
    }
  }
  recorrer(columnas.replace(/[`'"]/g, ""), [], true)
  const porRuta = new Map<string, EmbedDeOrdenes>()
  for (const e of encontrados) {
    const previo = porRuta.get(e.ruta)
    porRuta.set(e.ruta, previo ? { ...previo, interior: previo.interior && e.interior } : e)
  }
  return [...porRuta.values()]
}

/** The string constants of a file (`const NAME = "..."`), by name; `soloExportadas` keeps the ones another file can import. */
function constantesDeTexto(sf: ts.SourceFile, soloExportadas = false): Map<string, string> {
  const salida = new Map<string, string>()
  const visitar = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const sentencia = n.parent?.parent
      const exportada = !!sentencia && ts.isVariableStatement(sentencia) && !!ts.getModifiers(sentencia)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      const valor = textoDe(n.initializer)
      if (valor !== null && (!soloExportadas || exportada)) salida.set(n.name.text, valor)
    }
    ts.forEachChild(n, visitar)
  }
  visitar(sf)
  return salida
}

/** True when a string value names the orders table or embeds it. */
const nombraOEmbebeOrdenes = (valor: string) => valor.trim() === "ordenes_servicio" || embedsDeOrdenes(valor).length > 0

/** The EXPORTED string constants of a source that name or embed the orders table: what another file may use in a select. */
function constantesDeOrdenes(src: string, rel = "x.ts"): Map<string, string> {
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  return new Map([...constantesDeTexto(sf, true)].filter(([, valor]) => nombraOEmbebeOrdenes(valor)))
}

/**
 * The text of a `.select(..)` argument with the constants it uses written out: an identifier is followed
 * to the `const` it names (this file's, or one another file exports) and so is every `${NAME}` of a template;
 * any other `${..}` is dropped.
 */
function textoDelSelect(arg: ts.Node, sf: ts.SourceFile, locales: Map<string, string>, globales: Constantes): string {
  const valorDe = (nombre: string) => locales.get(nombre) ?? globales.get(nombre)
  const base = desenvolver(arg)
  if (ts.isIdentifier(base)) {
    const valor = valorDe(base.text)
    if (valor !== undefined) return valor
  }
  return arg
    .getText(sf)
    .replace(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g, (_todo, nombre: string) => valorDe(nombre) ?? "")
    .replace(/\$\{[^}]*\}/g, "")
}

function analizar(src: string, rel = "x.ts", globales: Constantes = new Map()): { sf: ts.SourceFile; lecturas: Lectura[] } {
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const lecturas: Lectura[] = []
  const locales = constantesDeTexto(sf)
  const contenedorDe = (n: ts.Node) => {
    let contenedor: ts.Node = n.parent
    while (!esFuncion(contenedor) && !ts.isSourceFile(contenedor)) contenedor = contenedor.parent
    return contenedor
  }
  const registrar = (n: ts.Node, embeds: EmbedDeOrdenes[], desde: ts.Node = n, esMencion = false) =>
    lecturas.push({ linea: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, posicion: n.getStart(sf), desde, contenedor: contenedorDe(n), embeds, esMencion })

  // The names a select uses: a constant of this file that a select reads is counted through the select.
  const usadasEnSelect = new Set<string>()
  const recogerNombres = (n: ts.Node) => {
    if (ts.isIdentifier(n)) usadasEnSelect.add(n.text)
    ts.forEachChild(n, recogerNombres)
  }
  const buscarSelects = (n: ts.Node) => {
    if (ts.isCallExpression(n) && nombreDeLlamada(n) === "select" && n.arguments[0]) recogerNombres(n.arguments[0])
    ts.forEachChild(n, buscarSelects)
  }
  buscarSelects(sf)

  /** A string that names the table or embeds it, handed to a call or held in a constant: a read that is built elsewhere. */
  const mencion = (n: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression) => {
    const texto = ts.isTemplateExpression(n) ? [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join(" ") : n.text
    if (!(!ts.isTemplateExpression(n) && texto.trim() === "ordenes_servicio") && embedsDeOrdenes(texto).length === 0) return
    let nodo: ts.Node = n
    while (nodo.parent && esTransparente(nodo.parent) && nodo.parent.expression === nodo) nodo = nodo.parent
    const padre = nodo.parent
    // A literal inside the first argument of a select is part of that select's read, which counts it.
    for (let a: ts.Node | undefined = n.parent; a && !esFuncion(a); a = a.parent) {
      if (ts.isCallExpression(a) && nombreDeLlamada(a) === "select" && a.arguments[0] && n.pos >= a.arguments[0].pos && n.end <= a.arguments[0].end) return
    }
    if (padre && ts.isCallExpression(padre) && padre.arguments.some((a) => a === nodo)) {
      const nombre = nombreDeLlamada(padre)
      if (nombre === "from" && ts.isPropertyAccessExpression(padre.expression) && padre.arguments[0] === nodo) return // a .from(..) is a read by itself
      if (nombre !== null && ENVOLTURAS.includes(nombre)) return // the embed a wrapper names (`aplicarAEmbed(q, "ordenes_servicio")`), not a table read
      if (esEntradaDeAuditoria(padre)) return // an audit entry names its entity, it reads nothing
      registrar(n, [], padre, true)
    } else if (padre && ts.isVariableDeclaration(padre) && padre.initializer === nodo) {
      if (ts.isIdentifier(padre.name) && usadasEnSelect.has(padre.name.text)) return // counted through the select that uses it
      registrar(n, [], n, true)
    }
  }

  const visitar = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) mencion(n)
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.arguments[0]) {
      const nombre = n.expression.name.text
      if (nombre === "from" && textoDe(n.arguments[0]) === "ordenes_servicio") {
        const padre = n.parent
        const metodo = ts.isPropertyAccessExpression(padre) && padre.expression === n ? padre.name.text : null
        if (metodo === null || !ESCRITURAS.includes(metodo)) registrar(n, [])
      }
      if (nombre === "select") {
        // A select that embeds the orders more than once is one read PER embed: a helper narrows the embed it
        // names, so a sibling embed next to a narrowed one is a read of its own (it needs its own helper or a listing).
        for (const embed of embedsDeOrdenes(textoDelSelect(n.arguments[0], sf, locales, globales))) registrar(n, [embed])
      }
    }
    ts.forEachChild(n, visitar)
  }
  visitar(sf)
  return { sf, lecturas: lecturas.sort((a, b) => a.posicion - b.posicion) }
}

/** The whole chain a read belongs to: `.from(..).select(..).eq(..)`, through `await`, `as` and parentheses. */
function topeDeLaCadena(n: ts.Node): ts.Node {
  let actual = n
  for (;;) {
    const p = actual.parent
    if (!p) return actual
    const sigue =
      (ts.isPropertyAccessExpression(p) && p.expression === actual) ||
      (ts.isCallExpression(p) && p.expression === actual) ||
      (esTransparente(p) && p.expression === actual)
    if (!sigue) return actual
    actual = p
  }
}

/**
 * A filter on a column of the embed that scopes it: `.eq("ordenes_servicio.sucursal_id", ..)`, or the same
 * through the table it hangs from (`.eq("facturas.ordenes_servicio.sucursal_id", ..)`), by the full path of the
 * embed. Only an `!inner` embed (every embed of its path) counts: without it PostgREST filters the embedded
 * rows and keeps EVERY parent row, so the read still returns the other branches' parents.
 */
function esFiltroDeEmbed(llamada: ts.CallExpression, embeds: EmbedDeOrdenes[]): boolean {
  if (!ts.isPropertyAccessExpression(llamada.expression) || !llamada.arguments[0]) return false
  const columna = textoDe(llamada.arguments[0])
  if (columna === null) return false
  return embeds.some((e) => e.interior && COLUMNAS_DE_ALCANCE.some((c) => columna === `${e.ruta}.${c}`))
}

/** `soloOriginadasEn(chain, s, "embed.sucursal_id")` filters like an `.eq` on the embed: it needs the embed to be `!inner` too. */
function envolturaSobreEmbedPlano(llamada: ts.CallExpression, embeds: EmbedDeOrdenes[]): boolean {
  if (nombreDeLlamada(llamada) !== "soloOriginadasEn" || embeds.length === 0) return false
  const columna = llamada.arguments[2] ? textoDe(llamada.arguments[2]) : null
  if (columna === null || !columna.includes(".")) return false
  const ruta = columna.split(".").slice(0, -1).join(".")
  const embed = embeds.find((e) => e.ruta === ruta)
  return embed !== undefined && !embed.interior
}

/** The position of the argument that names the embed a wrapper narrows, for the wrappers that take one. */
const ARGUMENTO_DEL_EMBED: Record<string, number> = { soloAtendidasPorEnEmbed: 2, aplicarAEmbed: 1 }

/**
 * A wrapper that names an embed (as a literal) narrows THAT embed: when the read is one embed of a select and the
 * wrapper names another (or one the select does not have), it covers nothing. A name that is not a literal is
 * taken for the embed of the read.
 */
function nombraOtroEmbed(llamada: ts.CallExpression, embeds: EmbedDeOrdenes[]): boolean {
  const nombre = nombreDeLlamada(llamada)
  const posicion = nombre === null ? undefined : ARGUMENTO_DEL_EMBED[nombre]
  if (posicion === undefined || embeds.length !== 1 || !llamada.arguments[posicion]) return false
  const nombrado = textoDe(llamada.arguments[posicion])
  return nombrado !== null && nombrado !== embeds[0].nombre && nombrado !== embeds[0].ruta
}

function llamadasDentro(raiz: ts.Node, cuando: (c: ts.CallExpression) => boolean): ts.CallExpression[] {
  const salida: ts.CallExpression[] = []
  const visitar = (n: ts.Node) => {
    if (ts.isCallExpression(n) && cuando(n)) salida.push(n)
    ts.forEachChild(n, visitar)
  }
  visitar(raiz)
  return salida
}

/** The identifier a chain starts from: `q.eq(..).neq(..)` starts from `q`. */
function raizDeLaCadena(n: ts.Node): string | null {
  let actual = desenvolver(n)
  while (ts.isCallExpression(actual) || ts.isPropertyAccessExpression(actual)) actual = desenvolver(actual.expression)
  return ts.isIdentifier(actual) ? actual.text : null
}

/** The variable a chain is stored in (`const q = chain`, `q = chain`, `q = c ? chain : other`), if any. */
function variableDeLaCadena(tope: ts.Node): string | null {
  let actual = tope
  for (;;) {
    const p = actual.parent
    if (!p) break
    if (esTransparente(p) && p.expression === actual) actual = p
    else if (ts.isConditionalExpression(p) && (p.whenTrue === actual || p.whenFalse === actual)) actual = p
    else break
  }
  const p = actual.parent
  if (p && ts.isVariableDeclaration(p) && p.initializer === actual && ts.isIdentifier(p.name)) return p.name.text
  if (p && ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && p.right === actual && ts.isIdentifier(p.left)) return p.left.text
  return null
}

/** The calls that cover a read, in the order they are tried: (A) inside the chain, (B) around it, (C) on the variable that holds it. */
function candidatas(lectura: Lectura): ts.CallExpression[] {
  const tope = topeDeLaCadena(lectura.desde)
  const salida: ts.CallExpression[] = []

  // (A) a filter builder, or a filter on the embed's branch / technician column, inside the chain. A table that
  // is only named by a string (`fetchAllRows("ordenes_servicio", .., (q) => ..)`) builds its query in a callback:
  // a wrapper applied there counts too.
  salida.push(
    ...llamadasDentro(tope, (c) => {
      const nombre = nombreDeLlamada(c)
      if (nombre !== null && FILTROS.includes(nombre)) return true
      if (lectura.esMencion && nombre !== null && ENVOLTURAS.includes(nombre)) return true
      return lectura.embeds.length > 0 && esFiltroDeEmbed(c, lectura.embeds)
    }),
  )

  // (B) the chain is the query argument of a wrapper.
  let actual: ts.Node = tope
  while (actual.parent && esTransparente(actual.parent) && actual.parent.expression === actual) actual = actual.parent
  const padre = actual.parent
  if (padre && ts.isCallExpression(padre) && padre.arguments[0] === actual) {
    const nombre = nombreDeLlamada(padre)
    if (nombre !== null && ENVOLTURAS.includes(nombre) && !envolturaSobreEmbedPlano(padre, lectura.embeds) && !nombraOtroEmbed(padre, lectura.embeds)) salida.push(padre)
  }

  // (C) the chain is held in a variable that a wrapper receives, or whose embed is filtered.
  const variable = variableDeLaCadena(tope)
  if (variable !== null) {
    salida.push(
      ...llamadasDentro(lectura.contenedor, (c) => {
        const nombre = nombreDeLlamada(c)
        if (nombre !== null && ENVOLTURAS.includes(nombre) && c.arguments[0]) {
          return raizDeLaCadena(c.arguments[0]) === variable && !envolturaSobreEmbedPlano(c, lectura.embeds) && !nombraOtroEmbed(c, lectura.embeds)
        }
        if (lectura.embeds.length > 0 && esFiltroDeEmbed(c, lectura.embeds)) {
          return ts.isPropertyAccessExpression(c.expression) && raizDeLaCadena(c.expression.expression) === variable
        }
        return false
      }),
    )
  }
  return salida
}

/** The reads of a source file that are not covered by a helper applied to them, as they were read. */
function lecturasSinAlcance(src: string, rel = "x.ts", globales: Constantes = new Map()): Lectura[] {
  const { lecturas } = analizar(src, rel, globales)
  const gastadas = new Set<ts.Node>()
  const sueltas: Lectura[] = []
  for (const lectura of lecturas) {
    const libre = candidatas(lectura).find((c) => !gastadas.has(c))
    if (libre) gastadas.add(libre)
    else sueltas.push(lectura)
  }
  return sueltas
}

/** The reads of a source file that are not covered by a helper applied to them: the ones that need a listing. */
function sinAlcance(src: string, rel = "x.ts", globales: Constantes = new Map()): number[] {
  return lecturasSinAlcance(src, rel, globales)
    .map((l) => l.linea)
    .sort((a, b) => a - b)
}

// ---------------------------------------------------------------------------------------------
// Reads that need no helper
// ---------------------------------------------------------------------------------------------
type Listado = Map<string, { sitios: number; motivo: string }>

const ASIGNADAS = "orders assigned to the technician himself (tecnico_id = his id), from any branch (BM-6)"
const CRON = "cron job: no user, the whole organization by design"
const SUPERADMIN = "platform superadmin: organization-wide statistics, not a tenant surface"
const PUBLICO = "reached with the public token of the order or quote; the customer has no branch"
const SOLO_ADMIN = "ADMIN only: an ADMIN's scope for an order by id is the whole organization, as in the loader"
const ONBOARDING = "onboarding: counts or seeds the organization's own orders, no branch involved"
const TOTAL_DE_ACTIVAS =
  "count only (just the ids of his open orders come out, and they are counted), it gates a global action (deactivating or deleting him), and the total is an ADMIN's: nobody else's answer carries it"

const EXENTOS: Listado = new Map([
  ["app/(dashboard)/dashboard/page.tsx", { sitios: 1, motivo: `the technician's cards: ${ASIGNADAS}` }],
  ["app/api/cron/engagement/route.ts", { sitios: 2, motivo: CRON }],
  ["app/api/cron/recordatorios/route.ts", { sitios: 1, motivo: CRON }],
  // The crons that name the table to a generic reader (`fetchAllRows("ordenes_servicio", ..)`, `countRows(..)`).
  ["app/api/cron/auto-archive-dormant/route.ts", { sitios: 1, motivo: `${CRON} (the last order date of every organization)` }],
  ["app/api/cron/feature-usage/route.ts", { sitios: 2, motivo: `${CRON} (counts of real orders per organization)` }],
  ["app/api/cron/lifecycle-emails/route.ts", { sitios: 1, motivo: `${CRON} (order history per organization for win-back and milestone emails)` }],
  ["app/api/cron/re-engagement/route.ts", { sitios: 1, motivo: `${CRON} (the last order date of every organization)` }],
  ["app/api/cron/trial-management/route.ts", { sitios: 1, motivo: `${CRON} (whether a trial organization has orders)` }],
  [
    "lib/reportes/notas-credito-devengado.ts",
    { sitios: 1, motivo: "defines the embed `ordenes_servicio(estado)` that the credit-note queries of the reports use: it reads only the order's state, and those queries are scoped by notas_credito.sucursal_id" },
  ],
  ["app/api/superadmin/email-campaigns/route.ts", { sitios: 2, motivo: SUPERADMIN }],
  ["app/api/superadmin/organizations/[id]/route.ts", { sitios: 1, motivo: SUPERADMIN }],
  ["app/api/superadmin/stats/engagement/route.ts", { sitios: 1, motivo: SUPERADMIN }],
  ["app/api/superadmin/stats/feature-usage/route.ts", { sitios: 2, motivo: SUPERADMIN }],
  ["app/api/superadmin/subscriptions/route.ts", { sitios: 1, motivo: SUPERADMIN }],
  ["app/api/public/cotizaciones/[token]/aprobar/route.ts", { sitios: 1, motivo: `the order linked to a quote, ${PUBLICO}` }],
  ["app/api/public/cotizaciones/[token]/rechazar/route.ts", { sitios: 1, motivo: `the order linked to a quote, ${PUBLICO}` }],
  ["app/api/public/kiosco/[token]/route.ts", { sitios: 1, motivo: PUBLICO }],
  ["lib/public-token.ts", { sitios: 1, motivo: PUBLICO }],
  ["app/api/v1/ordenes/route.ts", { sitios: 1, motivo: "public API with an organization key; /api/v1 is outside this change" }],
  ["app/api/whatsapp/webhook/route.ts", { sitios: 1, motivo: "webhook: a customer's reply, matched by phone, no session" }],
  ["app/api/onboarding/status/route.ts", { sitios: 1, motivo: ONBOARDING }],
  ["app/api/onboarding/seed-demo-data/route.ts", { sitios: 1, motivo: ONBOARDING }],
  ["lib/onboarding/practica.ts", { sitios: 3, motivo: `the practice order of the wizard and the real-order count: ${ONBOARDING}` }],
  ["lib/counters.ts", { sitios: 3, motivo: "resync of the organization's counters: the highest order number, and the highest quote and invoice numbers through their order (joined for the organization only)" }],
  ["lib/ordenes/alcance.ts", { sitios: 1, motivo: "the order loader itself: it IS the scope check (cargarOrdenEnAlcance)" }],
  ["lib/notifications/index.ts", { sitios: 1, motivo: "createNotificationContext has no callers; it builds a message from an order id its caller already loaded" }],
  ["app/api/facturacion/generar/route.ts", { sitios: 1, motivo: `invoice for an order by id. ${SOLO_ADMIN}` }],
  ["app/api/notas-credito/route.ts", { sitios: 1, motivo: `credit note for an order by id. ${SOLO_ADMIN}` }],
  [
    "app/api/ordenes/[id]/cobros/route.ts",
    { sitios: 2, motivo: "helper of POST (the handler loads the order through the loader first) and DELETE (ADMIN only, role first); both pinned in ordenes-subroutes-sweep" },
  ],
  [
    "lib/sucursal-personal.ts",
    { sitios: 1, motivo: `defines the \`activas_totales\` embed used by the technician selects: ${TOTAL_DE_ACTIVAS}` },
  ],
  ["app/api/tecnicos/route.ts", { sitios: 1, motivo: `the technicians list: ${TOTAL_DE_ACTIVAS}; it is next to the embed narrowed to the viewer's scope, which has its own wrapper` }],
  [
    "app/api/tecnicos/[id]/route.ts",
    {
      sitios: 2,
      motivo: `the \`activas_totales\` embed of the technician detail (${TOTAL_DE_ACTIVAS}), and the DELETE of a technician (ADMIN only): its guard counts EVERY open order he holds, in every branch, on purpose: scoping it would let him be deleted with work still assigned elsewhere`,
    },
  ],
  ["app/api/tecnicos/[id]/estado/route.ts", { sitios: 1, motivo: `deactivating or reactivating a technician: ${TOTAL_DE_ACTIVAS}` }],
  ["app/api/recepciones/[id]/route.ts", { sitios: 1, motivo: "PATCH of the reception's discount: counts its delivered orders. ADMIN only, role first (the GET reads through the reception's branch)" }],
  ["app/api/recepciones/[id]/entregar/route.ts", { sitios: 1, motivo: `delivery of a whole reception. ${SOLO_ADMIN}, and the role is checked first` }],
  ["app/api/sucursales/[id]/route.ts", { sitios: 1, motivo: "count of the orders of a branch before it is deleted (ADMIN only)" }],
  ["app/api/tipos-dispositivo/[id]/route.ts", { sitios: 1, motivo: "count of the orders of a device type before it is deleted (ADMIN only)" }],
  ["app/api/usuarios/[id]/sucursal/route.ts", { sitios: 1, motivo: "open orders assigned to a user, to warn before moving him (ADMIN only)" }],
  ["app/api/ventas/[id]/garantia/[garantiaId]/pdf/route.ts", { sitios: 1, motivo: "the signature image of the user who delivered, for the warranty PDF of a sale; not a list of orders" }],
  // The next ones join the order of a money row to learn its organization, client or branch.
  // No order data comes back: they follow the money rule (the origin branch), not the order list.
  ["app/api/caja/movimientos/metodo-pago/route.ts", { sitios: 2, motivo: "joins the order of a collection or of an invoice payment only for its branch (the origin) that the handler checks; nothing else of the order is read" }],
  ["app/api/facturacion/[id]/route.ts", { sitios: 2, motivo: "invoice by id (void, delete): joins the order for its organization, client and branch (the origin), to re-credit the client account there; no order data is returned" }],
  ["app/api/pagos/route.ts", { sitios: 1, motivo: "payment of an invoice by id: joins the order for its organization, client and branch (the origin); no order data is returned" }],
  // The credit notes of the two financial reports select the order's state through the shared embed.
  ["app/api/reportes/estado-resultados/route.ts", { sitios: 1, motivo: "the credit-note query selects only the state of the order (the shared embed `ordenes_servicio(estado)`); it is scoped by notas_credito.sucursal_id, the origin branch" }],
  ["app/api/reportes/tendencia-financiera/route.ts", { sitios: 1, motivo: "the credit-note query selects only the state of the order (the shared embed `ordenes_servicio(estado)`); it is scoped by notas_credito.sucursal_id, the origin branch" }],
  // Public: reached with the token of the quote.
  ["app/api/public/cotizaciones/[token]/route.ts", { sitios: 1, motivo: `the order linked to a quote, ${PUBLICO}` }],
  ["app/api/public/cotizaciones/[token]/pdf/route.ts", { sitios: 1, motivo: `the order linked to a quote, ${PUBLICO}` }],
  ["app/api/ordenes/[id]/pdf/route.ts", { sitios: 1, motivo: "the number of the order a re-entry comes from, by the id stored on the order the handler already loaded in scope: one number, no listing" }],
  [
    "app/api/turnos/route.ts",
    { sitios: 2, motivo: "the order linked to an appointment (id, number, code only): the list is scoped by the appointment's own branch and the link is picked from the scoped orders picker; the appointments surface scopes the link itself" },
  ],
  [
    "app/api/turnos/[id]/route.ts",
    { sitios: 2, motivo: "the order linked to an appointment (id, number, code only): the list is scoped by the appointment's own branch and the link is picked from the scoped orders picker; the appointments surface scopes the link itself" },
  ],
])

// Reads that PR5b was to scope: technician views and counts, invoicing candidates, pending orders of a
// client, receptions, credit notes, reports. It is empty: PR5b scoped them all.
const PENDIENTE_PR5B: Listado = new Map()

// Reads of quotes and warranties (the order a quote is for, the order a warranty covers): scoped by the
// change that gives quotes and warranties a branch (PR20).
const PENDIENTE_PR20: Listado = new Map([
  ["app/api/cotizaciones/route.ts", { sitios: 4, motivo: "the order a quote is created for, and the order a quote embeds" }],
  ["app/api/cotizaciones/[id]/route.ts", { sitios: 7, motivo: "the order linked to a quote" }],
  ["app/api/cotizaciones/[id]/enviar/route.ts", { sitios: 2, motivo: "the order linked to a quote" }],
  ["app/api/cotizaciones/[id]/aprobar/route.ts", { sitios: 3, motivo: "the order linked to a quote" }],
  ["app/api/cotizaciones/[id]/convertir-venta/route.ts", { sitios: 1, motivo: "the order linked to a quote" }],
  ["app/api/cotizaciones/[id]/pdf/route.ts", { sitios: 1, motivo: "the order linked to a quote" }],
  ["app/api/garantias/route.ts", { sitios: 2, motivo: "warranties of orders" }],
  ["app/api/garantias/[id]/route.ts", { sitios: 3, motivo: "a warranty of an order" }],
  ["app/api/garantias/[id]/reclamos/route.ts", { sitios: 2, motivo: "claims of a warranty of an order" }],
  ["app/api/export/[entity]/route.ts", { sitios: 1, motivo: "the warranties export embeds the order each warranty covers" }],
])

const LISTAS: Array<[string, Listado]> = [
  ["EXENTOS", EXENTOS],
  ["PENDIENTE_PR5B", PENDIENTE_PR5B],
  ["PENDIENTE_PR20", PENDIENTE_PR20],
]

/** The lines of a source that are reported as loose. */
const sueltas = (src: string, constantes: Record<string, string> = {}) =>
  sinAlcance(`export async function GET() {\n${src}\n}`, "x.ts", new Map(Object.entries(constantes))).map((l) => l - 1)

describe("detector, with planted offenders", () => {
  it("reports a read in a function that calls no helper", () => {
    expect(sueltas(`  const { data } = await supabaseAdmin.from("ordenes_servicio").select("*").eq("organization_id", o)`)).toEqual([1])
  })

  describe("(A) a filter builder inside the read's own chain", () => {
    it.each(FILTROS)("accepts %s", (filtro) => {
      expect(sueltas(`  const q = await supabaseAdmin.from("ordenes_servicio").select("*").or(${filtro}(s))`)).toEqual([])
    })

    it("accepts a filter builder nested in the arguments of the chain (combinarOr)", () => {
      expect(sueltas(`  return supabaseAdmin.from("ordenes_servicio").select("*").or(combinarOr(filtroVisibleEnSucursal(s), busqueda))`)).toEqual([])
    })

    it("a filter builder in ANOTHER statement does not cover the read", () => {
      expect(sueltas(`  const f = filtroVisibleEnSucursal(s)\n  return supabaseAdmin.from("ordenes_servicio").select("*").or(f)`)).toEqual([2])
    })
  })

  describe("(B) the chain is the argument of a wrapper", () => {
    it.each(["soloAtendidasPor", "soloOriginadasEn"])("accepts %s(chain, sucursal)", (envoltura) => {
      expect(sueltas(`  return ${envoltura}(supabaseAdmin.from("ordenes_servicio").select("*").eq("organization_id", o), s)`)).toEqual([])
    })

    it("accepts soloAtendidasPorEnEmbed(chain, sucursal, embed) around a select that embeds the orders, with more calls after it", () => {
      const src = `  return soloAtendidasPorEnEmbed(supabaseAdmin.from("users").select("id, ordenes_servicio:ordenes_servicio!tecnico_id (id, estado)").eq("rol", "TECNICO"), s, "ordenes_servicio").order("nombre")`
      expect(sueltas(src)).toEqual([])
    })

    it("accepts the door's aplicar and aplicarAEmbed as methods", () => {
      expect(sueltas(`  return alcance.aplicar(supabaseAdmin.from("ordenes_servicio").select("*"))`)).toEqual([])
      expect(sueltas(`  return alcance.aplicarAEmbed(supabaseAdmin.from("clientes").select("id, ordenes_servicio(id)"), "ordenes_servicio")`)).toEqual([])
    })

    it("sees through await, as, a non-null assertion and parentheses", () => {
      expect(sueltas(`  return soloAtendidasPor((await supabaseAdmin.from("ordenes_servicio").select("*")) as Q, s)`)).toEqual([])
      expect(sueltas(`  return soloAtendidasPor(supabaseAdmin.from("ordenes_servicio").select("*")!, s)`)).toEqual([])
    })

    it("a wrapper around ANOTHER table's query does not cover an unscoped read of orders in the same function", () => {
      const src = `  const ventas = soloOriginadasEn(supabaseAdmin.from("ventas").select("*"), s)\n  const ordenes = await supabaseAdmin.from("ordenes_servicio").select("*")`
      expect(sueltas(src)).toEqual([2])
    })
  })

  describe("(C) the chain is held in a variable that a wrapper receives", () => {
    it.each(ENVOLTURAS)("accepts %s(variable)", (envoltura) => {
      const llamada = envoltura === "aplicar" || envoltura === "aplicarAEmbed" ? `alcance.${envoltura}(q)` : `${envoltura}(q, s)`
      expect(sueltas(`  let q = supabaseAdmin.from("ordenes_servicio").select("*")\n  q = ${llamada}`)).toEqual([])
    })

    it("also when the wrapper takes a chain that starts from the variable", () => {
      expect(sueltas(`  const q = supabaseAdmin.from("ordenes_servicio").select("*")\n  return soloAtendidasPor(q.eq("organization_id", o).order("fecha"), s)`)).toEqual([])
    })

    it("and when the variable holds one of the two selects of a conditional (the join is added only with a branch)", () => {
      const base = `  const base = supabaseAdmin.from("cobros_orden")\n  const consulta = s === null ? base.select("a") : base.select("a, ordenes_servicio!inner(sucursal_id)")\n`
      expect(sueltas(`${base}  return soloOriginadasEn(consulta.eq("x", y).neq("z", w), s, "ordenes_servicio.sucursal_id")`)).toEqual([])
      expect(sueltas(`${base}  return consulta.eq("x", y).neq("z", w)`)).toEqual([2])
    })

    it("also when the variable is assigned later", () => {
      expect(sueltas(`  let q: any\n  q = supabaseAdmin.from("ordenes_servicio").select("*")\n  q = soloAtendidasPor(q, s)`)).toEqual([])
    })

    it("a different variable does not cover it", () => {
      expect(sueltas(`  const q = supabaseAdmin.from("ordenes_servicio").select("*")\n  const otra = soloAtendidasPor(algo, s)`)).toEqual([1])
    })
  })

  describe("one helper call covers ONE read", () => {
    it("a second read next to one helper call is reported", () => {
      const src = `  const a = soloAtendidasPor(supabaseAdmin.from("ordenes_servicio").select("id"), s)\n  const b = await supabaseAdmin.from("ordenes_servicio").select("estado")`
      expect(sueltas(src)).toEqual([2])
    })

    it("two reads with two helper calls pass", () => {
      const src = `  const a = soloAtendidasPor(supabaseAdmin.from("ordenes_servicio").select("id"), s)\n  const b = soloOriginadasEn(supabaseAdmin.from("ordenes_servicio").select("estado"), s)`
      expect(sueltas(src)).toEqual([])
    })

    it("one helper call that covers two reads through an ancestor function does not: a callback needs its own", () => {
      const src = `  const f = filtroVisibleEnSucursal(s)\n  return ids.map(async (id) => supabaseAdmin.from("ordenes_servicio").select("*").or(f))`
      expect(sueltas(src)).toEqual([2])
    })

    it("a variable that is reused for a second read does not take the same wrapper call twice", () => {
      const src = `  let q = supabaseAdmin.from("ordenes_servicio").select("id")\n  q = soloAtendidasPor(q, s)\n  q = supabaseAdmin.from("ordenes_servicio").select("estado")`
      expect(sueltas(src)).toEqual([3])
    })

    it("only the QUERY argument of a wrapper counts: a read passed as another argument is not narrowed by it", () => {
      expect(sueltas(`  return soloAtendidasPor(q, supabaseAdmin.from("ordenes_servicio").select("*"))`)).toEqual([1])
    })

    it("a variable held query passed to a wrapper once covers only the first read that holds it", () => {
      const src = `  const q = supabaseAdmin.from("ordenes_servicio").select("id")\n  const r = supabaseAdmin.from("ordenes_servicio").select("estado")\n  soloAtendidasPor(q, s)`
      expect(sueltas(src)).toEqual([2])
    })

    it("a factory arrow is its own function: its helper does not cover the reads outside it", () => {
      const src = `  const a = () => soloAtendidasPor(supabaseAdmin.from("ordenes_servicio").select("id"), s)\n  const b = await supabaseAdmin.from("ordenes_servicio").select("estado")`
      expect(sueltas(src)).toEqual([2])
    })
  })

  describe("a select that embeds the orders twice is two reads: a helper narrows the embed it names, not its sibling", () => {
    // The technicians' count in the scope (`alcance`) next to their open orders of every branch (`activas`).
    const doble = (envuelto: (consulta: string) => string) =>
      `  return ${envuelto(`supabaseAdmin.from("users").select("id, alcance:ordenes_servicio!tecnico_id (id, estado), activas:ordenes_servicio!tecnico_id (id)").eq("rol", "TECNICO")`)}`
    const embedsSueltos = (src: string) => lecturasSinAlcance(`export async function GET() {\n${src}\n}`).flatMap((l) => l.embeds.map((e) => e.nombre))

    it("the wrapper that names one embed covers that one and leaves the other loose", () => {
      expect(embedsSueltos(doble((q) => `soloAtendidasPorEnEmbed(${q}, s, "alcance")`))).toEqual(["activas"])
      expect(embedsSueltos(doble((q) => `soloAtendidasPorEnEmbed(${q}, s, "activas")`))).toEqual(["alcance"])
      expect(embedsSueltos(doble((q) => `alcance.aplicarAEmbed(${q}, "alcance")`))).toEqual(["activas"])
    })

    it("a wrapper that names an embed the select does not have covers neither", () => {
      expect(embedsSueltos(doble((q) => `soloAtendidasPorEnEmbed(${q}, s, "ordenes_servicio")`))).toEqual(["alcance", "activas"])
    })

    it("a wrapper that does not say which embed it narrows (a variable) is taken for the first one", () => {
      expect(embedsSueltos(doble((q) => `soloAtendidasPorEnEmbed(${q}, s, embed)`))).toEqual(["activas"])
    })

    it("with no wrapper both are loose, and a select with one embed is still one read", () => {
      expect(embedsSueltos(doble((q) => q))).toEqual(["alcance", "activas"])
      expect(embedsSueltos(`  return soloAtendidasPorEnEmbed(supabaseAdmin.from("users").select("id, alcance:ordenes_servicio!tecnico_id (id)"), s, "alcance")`)).toEqual([])
    })

    it("a filter builder in the chain covers one of them", () => {
      expect(embedsSueltos(doble((q) => `${q}.or(filtroAtiendeSucursal(s), { referencedTable: "alcance" })`))).toEqual(["activas"])
    })

    it("the file reports the second embed on the line of the select, as one more loose read of it", () => {
      expect(sueltas(doble((q) => `soloAtendidasPorEnEmbed(${q}, s, "alcance")`))).toEqual([1])
    })
  })

  describe("calls that are approved but cover nothing by being called", () => {
    it("the door factory without .aplicar on the read", () => {
      const src = `  const alcance = await alcanceLecturaOrdenes(actor)\n  return supabaseAdmin.from("ordenes_servicio").select("*").eq("organization_id", o)`
      expect(sueltas(src)).toEqual([2])
    })

    it("the order loader next to a read of orders", () => {
      const src = `  const cargada = await cargarOrdenEnAlcance(id, actor, "leer")\n  return supabaseAdmin.from("ordenes_servicio").select("numero_orden").eq("id", id)`
      expect(sueltas(src)).toEqual([2])
    })

    it("a helper that is only named in a comment or a string", () => {
      const src = `  // soloAtendidasPor(q, s)\n  const x = "filtroVisibleEnSucursal()"\n  return supabaseAdmin.from("ordenes_servicio").select("*")`
      expect(sueltas(src)).toEqual([3])
    })

    it("a helper called in ANOTHER function", () => {
      const src = `function a() { return soloAtendidasPor(q, s) }\nexport async function GET() {\n  return supabaseAdmin.from("ordenes_servicio").select("*")\n}`
      expect(sinAlcance(src)).toEqual([3])
    })
  })

  describe("how the table is written", () => {
    it.each([
      ["single quotes", `supabaseAdmin.from('ordenes_servicio').select('*')`],
      ["a template literal without substitutions", "supabaseAdmin.from(`ordenes_servicio`).select('*')"],
      ["another client variable", `db.from("ordenes_servicio").select("*")`],
      ["as const", `supabaseAdmin.from("ordenes_servicio" as const).select("*")`],
      ["parentheses", `supabaseAdmin.from(("ordenes_servicio")).select("*")`],
      ["a non-null assertion", `supabaseAdmin.from("ordenes_servicio"!).select("*")`],
      ["satisfies", `supabaseAdmin.from("ordenes_servicio" satisfies string).select("*")`],
    ])("detects the table written with %s", (_forma, expr) => {
      expect(sueltas(`  return ${expr}`)).toEqual([1])
    })

    it("a chain that is held in a variable before it is used cannot be seen: it counts as a read", () => {
      expect(sueltas(`  const q = supabaseAdmin.from("ordenes_servicio")\n  return q.select("*")`)).toEqual([1])
    })

    it("ignores other tables", () => {
      expect(sueltas(`  return supabaseAdmin.from("ventas").select("*")`)).toEqual([])
    })
  })

  it.each([
    ["insert", `supabaseAdmin.from("ordenes_servicio").insert({ a: 1 })`],
    ["update", `supabaseAdmin.from("ordenes_servicio").update({ a: 1 }).eq("id", x)`],
    ["upsert", `supabaseAdmin.from("ordenes_servicio").upsert({ a: 1 })`],
    ["delete", `supabaseAdmin.from("ordenes_servicio").delete().eq("id", x)`],
  ])("a %s is a write: not swept here", (_metodo, expr) => {
    expect(sueltas(`  await ${expr}`)).toEqual([])
  })

  it("a read at the top of the module is held by the file itself", () => {
    expect(sinAlcance(`const q = supabaseAdmin.from("ordenes_servicio").select("*")`)).toEqual([1])
    expect(sinAlcance(`const q = soloAtendidasPor(supabaseAdmin.from("ordenes_servicio").select("*"), s)`)).toEqual([])
  })

  describe("reads of orders through an embed", () => {
    it.each([
      ["the plain embed", `id, ordenes_servicio (id, numero_orden)`],
      ["an alias", `id, orden:ordenes_servicio(id)`],
      ["an inner join", `id, ordenes_servicio!inner(organization_id)`],
      ["a foreign-key hint", `id, ordenes_servicio!cotizaciones_orden_id_fkey (id)`],
      ["an alias with a hint and an inner join", `id, orden:ordenes_servicio!orden_id_fkey!inner(id)`],
      ["the table reached through a column", `id, ordenes_servicio:orden_id (id, codigo_orden)`],
      ["the table reached through a column, as an inner join", `id, ordenes_servicio:orden_id!inner(sucursal_id)`],
      ["an embed inside another embed", `id, facturas!inner(ordenes_servicio!inner(organization_id))`],
      ["an alias of the table's own name over a hint", `id, ordenes_servicio:ordenes_servicio!tecnico_id (id, estado)`],
    ])("detects %s", (_forma, columnas) => {
      expect(sueltas(`  return supabaseAdmin.from("clientes").select(\`${columnas}\`)`)).toEqual([1])
    })

    it("detects it in a select written with a conditional of two templates (the select of the notification history)", () => {
      expect(sueltas("  return supabaseAdmin.from(\"notification_logs\").select(c ? `id, ordenes_servicio!inner (numero_orden)` : `id, ordenes_servicio (numero_orden)`)")).toEqual([1])
    })

    it("follows a select held in a constant of the same file", () => {
      expect(sinAlcance(`const COLUMNAS = "id, ordenes_servicio(id)"\nexport async function GET() {\n  return supabaseAdmin.from("clientes").select(COLUMNAS)\n}`)).toEqual([3])
    })

    it.each([
      ["a column that only mentions the name", `id, ordenes_servicio_id`],
      ["a column called like an embed but not followed by a parenthesis", `id, ordenes_servicio`],
      ["another table that ends the same", `id, mis_ordenes_servicio(id)`],
      ["a text after a dot", `id, x.ordenes_servicio(id)`],
    ])("does not take %s for an embed", (_forma, columnas) => {
      expect(sueltas(`  return supabaseAdmin.from("clientes").select("${columnas}")`)).toEqual([])
    })

    it("accepts the door's .aplicarAEmbed around it, an .or with referencedTable inside the chain through a filter builder, and soloOriginadasEn with the embed's column", () => {
      expect(sueltas(`  return alcance.aplicarAEmbed(supabaseAdmin.from("clientes").select("id, ordenes_servicio(id)"), "ordenes_servicio")`)).toEqual([])
      expect(sueltas(`  return supabaseAdmin.from("clientes").select("id, ordenes_servicio(id)").or(filtroVisibleEnSucursal(s), { referencedTable: "ordenes_servicio" })`)).toEqual([])
      expect(sueltas(`  return soloOriginadasEn(supabaseAdmin.from("facturas").select("id, ordenes_servicio!inner(sucursal_id)"), s, "ordenes_servicio.sucursal_id")`)).toEqual([])
    })

    it("accepts a filter on the embed's branch column in the chain, or on the variable that holds it", () => {
      expect(sueltas(`  return supabaseAdmin.from("facturas").select("id, ordenes_servicio!inner(sucursal_id)").eq("ordenes_servicio.sucursal_id", s)`)).toEqual([])
      expect(sueltas(`  let q = supabaseAdmin.from("facturas").select("id, ordenes_servicio!inner(sucursal_id)")\n  if (s) q = q.eq("ordenes_servicio.sucursal_id", s)`)).toEqual([])
      expect(sueltas(`  return supabaseAdmin.from("facturas").select("id, orden:ordenes_servicio!inner(sucursal_id)").eq("orden.sucursal_id", s)`)).toEqual([])
    })

    it("accepts the filter through the table the embed hangs from", () => {
      const src = `  let q = supabaseAdmin.from("pagos_parciales").select("id, facturas!inner(ordenes_servicio!inner(organization_id, sucursal_id))")\n  if (s) q = q.eq("facturas.ordenes_servicio.sucursal_id", s)`
      expect(sueltas(src)).toEqual([])
    })

    it("a filter on a longer path that merely ends the same does not count (another table's branch)", () => {
      expect(sueltas(`  return supabaseAdmin.from("facturas").select("id, ordenes_servicio!inner(organization_id)").eq("xordenes_servicio.sucursal_id", s)`)).toEqual([1])
    })

    it("a filter on the embed's ORGANIZATION does not scope it by branch", () => {
      expect(sueltas(`  return supabaseAdmin.from("facturas").select("id, ordenes_servicio!inner(organization_id)").eq("ordenes_servicio.organization_id", o)`)).toEqual([1])
    })

    it("a filter on another embed's branch column does not cover it", () => {
      expect(sueltas(`  return supabaseAdmin.from("facturas").select("id, ordenes_servicio!inner(organization_id), ventas(sucursal_id)").eq("ventas.sucursal_id", s)`)).toEqual([1])
    })

    it("an embed with no scope next to a scoped direct read: each needs its own", () => {
      const src = `  const a = soloAtendidasPor(supabaseAdmin.from("ordenes_servicio").select("id"), s)\n  const b = await supabaseAdmin.from("clientes").select("id, ordenes_servicio(id)")`
      expect(sueltas(src)).toEqual([2])
    })
  })

  describe("a filter on the embed scopes it only when the embed is !inner (without it every parent row stays)", () => {
    const tabla = (select: string, resto: string) => `  return supabaseAdmin.from("facturas").select("${select}")${resto}`

    it.each([
      ["a plain embed filtered by branch", "id, ordenes_servicio(sucursal_id)", `.eq("ordenes_servicio.sucursal_id", s)`],
      ["a plain embed filtered by technician", "id, ordenes_servicio(tecnico_id)", `.eq("ordenes_servicio.tecnico_id", u)`],
      ["an aliased plain embed", "id, orden:ordenes_servicio(sucursal_id)", `.eq("orden.sucursal_id", s)`],
      ["a plain embed behind a foreign-key hint", "id, ordenes_servicio!orden_id_fkey(sucursal_id)", `.eq("ordenes_servicio.sucursal_id", s)`],
      ["an inner embed under a plain one", "id, facturas(ordenes_servicio!inner(sucursal_id))", `.eq("facturas.ordenes_servicio.sucursal_id", s)`],
      ["a plain embed under an inner one", "id, facturas!inner(ordenes_servicio(sucursal_id))", `.eq("facturas.ordenes_servicio.sucursal_id", s)`],
    ])("does not count: %s", (_caso, select, filtro) => {
      expect(sueltas(tabla(select, filtro))).toEqual([1])
    })

    it.each([
      ["an inner embed filtered by branch", "id, ordenes_servicio!inner(sucursal_id)", `.eq("ordenes_servicio.sucursal_id", s)`],
      ["an inner embed filtered by technician", "id, ordenes_servicio!inner(tecnico_id)", `.eq("ordenes_servicio.tecnico_id", u)`],
      ["an aliased inner embed", "id, orden:ordenes_servicio!inner(sucursal_id)", `.eq("orden.sucursal_id", s)`],
      ["an inner embed behind a foreign-key hint", "id, ordenes_servicio!orden_id_fkey!inner(sucursal_id)", `.eq("ordenes_servicio.sucursal_id", s)`],
      ["inner embeds all the way down", "id, facturas!inner(ordenes_servicio!inner(sucursal_id))", `.eq("facturas.ordenes_servicio.sucursal_id", s)`],
    ])("counts: %s", (_caso, select, filtro) => {
      expect(sueltas(tabla(select, filtro))).toEqual([])
    })

    it("the same rule when the chain is held in a variable and the filter is applied to it", () => {
      const con = (select: string) => `  let q = supabaseAdmin.from("facturas").select("${select}")\n  if (s) q = q.eq("ordenes_servicio.sucursal_id", s)`
      expect(sueltas(con("id, ordenes_servicio(sucursal_id)"))).toEqual([1])
      expect(sueltas(con("id, ordenes_servicio!inner(sucursal_id)"))).toEqual([])
    })

    it("the drop of !inner from a real-looking invoice read is caught (the sweep used to stay green)", () => {
      const factura = (select: string) =>
        `  const q = supabaseAdmin.from("facturas").select(\`*, ${select} (id, numero_orden, sucursal_id, clientes (*)), pagos_parciales (*)\`).eq("id", id)\n  return opts?.sid ? q.eq("ordenes_servicio.sucursal_id", opts.sid) : q`
      expect(sueltas(factura("ordenes_servicio!inner"))).toEqual([])
      expect(sueltas(factura("ordenes_servicio"))).toEqual([1])
    })

    it("a wrapper that names the embed's column needs the embed to be !inner too", () => {
      const con = (select: string) => `  return soloOriginadasEn(supabaseAdmin.from("facturas").select("${select}"), s, "ordenes_servicio.sucursal_id")`
      expect(sueltas(con("id, ordenes_servicio!inner(sucursal_id)"))).toEqual([])
      expect(sueltas(con("id, ordenes_servicio(sucursal_id)"))).toEqual([1])
    })

    it("a select with two shapes counts as inner only if both are", () => {
      const con = (a: string, b: string) => `  return supabaseAdmin.from("facturas").select(c ? "id, ${a}(sucursal_id)" : "id, ${b}(sucursal_id)").eq("ordenes_servicio.sucursal_id", s)`
      expect(sueltas(con("ordenes_servicio!inner", "ordenes_servicio!inner"))).toEqual([])
      expect(sueltas(con("ordenes_servicio!inner", "ordenes_servicio"))).toEqual([1])
    })

    it("the door's wrappers stay accepted on a plain embed: they narrow the embedded orders on purpose (the client detail)", () => {
      expect(sueltas(`  return alcance.aplicarAEmbed(supabaseAdmin.from("clientes").select("id, ordenes_servicio(id)"), "ordenes_servicio")`)).toEqual([])
      expect(sueltas(`  return supabaseAdmin.from("clientes").select("id, ordenes_servicio(id)").or(filtroVisibleEnSucursal(s), { referencedTable: "ordenes_servicio" })`)).toEqual([])
    })
  })

  describe("an embed assembled from a constant of another file", () => {
    const NC = { NC_ORDEN_ESTADO_EMBED: "ordenes_servicio(estado)" }

    it("is followed through ${} in a template: the notes of credit select the order's state", () => {
      const src = "  return supabaseAdmin.from(\"notas_credito\").select(`monto, venta_id, orden_id, ${NC_ORDEN_ESTADO_EMBED}`).eq(\"organization_id\", o)"
      expect(sueltas(src, NC)).toEqual([1])
    })

    it("a filter on the parent's own branch column does not scope the embedded order, but a wrapper does", () => {
      const select = "supabaseAdmin.from(\"notas_credito\").select(`monto, ${NC_ORDEN_ESTADO_EMBED}`)"
      expect(sueltas(`  let q = ${select}\n  if (s) q = q.eq("sucursal_id", s)`, NC)).toEqual([1])
      expect(sueltas(`  return soloOriginadasEn(${select}, s)`, NC)).toEqual([])
    })

    it("is followed when the constant is the whole select argument", () => {
      expect(sueltas(`  return supabaseAdmin.from("notas_credito").select(NC_ORDEN_ESTADO_EMBED)`, NC)).toEqual([1])
    })

    it("a constant that is not an orders embed is not a read", () => {
      expect(sueltas("  return supabaseAdmin.from(\"notas_credito\").select(`monto, ${OTRA_COSA}`)", { OTRA_COSA: "clientes(nombre)" })).toEqual([])
      expect(sueltas("  return supabaseAdmin.from(\"notas_credito\").select(`monto, ${DESCONOCIDA}`)")).toEqual([])
    })

    it("the definition of such a constant is itself reported (anyone could use it elsewhere)", () => {
      expect(sinAlcance(`export const NC_ORDEN_ESTADO_EMBED = "ordenes_servicio(estado)"`)).toEqual([1])
    })

    it("a constant of the same file that a select uses is ONE read, not two", () => {
      const src = `const COLUMNAS = "id, ordenes_servicio(id)"\nexport async function GET() {\n  return supabaseAdmin.from("clientes").select(COLUMNAS)\n}`
      expect(sinAlcance(src)).toEqual([3])
      expect(sinAlcance(`const COLUMNAS = "id, ordenes_servicio(id)"\nexport async function GET() {\n  return soloOriginadasEn(supabaseAdmin.from("clientes").select(COLUMNAS), s)\n}`)).toEqual([])
    })

    it("only the constants a file EXPORTS are offered to the others (a private constant of the same name is another thing)", () => {
      expect([...constantesDeOrdenes(`export const A = "ordenes_servicio(estado)"\nconst B = "ordenes_servicio(id)"\nexport const C = "clientes(nombre)"`).keys()]).toEqual(["A"])
    })

    it("a template literal that holds the embed and is handed to something else is reported", () => {
      expect(sueltas("  return construir(`id, ordenes_servicio(id)`)")).toEqual([1])
    })
  })

  describe("the table named as a string value", () => {
    it.each([
      ["a generic row reader", `  return fetchAllRows("ordenes_servicio", "organization_id", (q) => q.gte("fecha_ingreso", desde))`],
      ["a row counter", `  return countRows("ordenes_servicio", o, undefined, { soloReales: true })`],
      ["a call that is not a query at all", `  return anything(1, "ordenes_servicio")`],
      ["a name held in a constant that a query then uses", `  const TABLA = "ordenes_servicio"\n  return supabaseAdmin.from(TABLA).select("id")`],
      ["the table typed with as const", `  return fetchAllRows("ordenes_servicio" as const, "id", (q) => q)`],
    ])("reports %s", (_caso, src) => {
      expect(sueltas(src)).toHaveLength(1)
    })

    it("a filter builder inside the reader's callback scopes it", () => {
      expect(sueltas(`  return fetchAllRows("ordenes_servicio", "id", (q) => q.or(filtroAtiendeSucursal(s)))`)).toEqual([])
    })

    it("a wrapper applied to the reader's query, or around the reader, scopes it", () => {
      expect(sueltas(`  return fetchAllRows("ordenes_servicio", "id", (q) => soloAtendidasPor(q, s))`)).toEqual([])
      expect(sueltas(`  return soloAtendidasPor(fetchAllRows("ordenes_servicio", "id", (q) => q), s)`)).toEqual([])
    })

    it("a wrapper in the callback of ANOTHER table's reader does not scope this one", () => {
      const src = `  await fetchAllRows("ventas", "id", (q) => soloOriginadasEn(q, s))\n  return fetchAllRows("ordenes_servicio", "id", (q) => q)`
      expect(sueltas(src)).toEqual([2])
    })

    it("the table of a .from is still ONE read, however it is written", () => {
      expect(sueltas(`  return supabaseAdmin.from("ordenes_servicio").select("id")`)).toEqual([1])
    })

    it("text that only talks about the table is not a read: prose, a property value, a comparison", () => {
      expect(sueltas(`  const nota = "ordenes_servicio no tiene created_at"`)).toEqual([])
      expect(sueltas(`  await log({ entidad: "ordenes_servicio" })`)).toEqual([])
      expect(sueltas(`  return tabla === "ordenes_servicio"`)).toEqual([])
      expect(sueltas(`  // fetchAllRows("ordenes_servicio", "id", q)\n  return 1`)).toEqual([])
    })

    it("an audit entry names its entity and reads nothing; the same call on anything else is reported", () => {
      expect(sueltas(`  await audit.create("ordenes_servicio", id, { a: 1 })`)).toEqual([])
      expect(sueltas(`  await audit.update("ordenes_servicio", id, antes, despues)`)).toEqual([])
      expect(sueltas(`  await createAuditLogger(o, u, request).delete("ordenes_servicio", id, orden)`)).toEqual([])
      expect(sueltas(`  await cache.update("ordenes_servicio", id, antes, despues)`)).toEqual([1])
      expect(sueltas(`  await audit.leer("ordenes_servicio", id)`)).toEqual([1])
    })

    it("a table named by a parameter cannot be seen here: its callers are the ones swept", () => {
      expect(sueltas(`  return supabaseAdmin.from(tabla).select("*")`)).toEqual([])
    })
  })
})

describe("source tree", () => {
  const fuentes = leerFuentes(["app", "lib", "components", "hooks", "contexts"])
  // The constants the files export that name or embed the table: a `${NAME}` in a select of another file is followed.
  const globales: Constantes = new Map(fuentes.filter(({ src }) => src.includes("ordenes_servicio")).flatMap(({ rel, src }) => [...constantesDeOrdenes(src, rel)]))
  const archivos = fuentes
    .filter(({ src }) => src.includes("ordenes_servicio") || [...globales.keys()].some((nombre) => src.includes(nombre)))
    .map(({ rel, src }) => ({ rel, src, sueltas: sinAlcance(src, rel, globales), lecturas: analizar(src, rel, globales).lecturas.length }))

  it("scans the real tree (guards against a ghost loop)", () => {
    const rels = new Set(archivos.map((a) => a.rel))
    expect(archivos.reduce((suma, a) => suma + a.lecturas, 0)).toBeGreaterThan(20)
    for (const esperado of [
      "app/api/ordenes/route.ts",
      "app/api/ordenes/compromisos/route.ts",
      "app/(dashboard)/dashboard/page.tsx",
      "lib/ordenes/alcance.ts",
      // reaches orders only through an embed
      "app/api/clientes/[id]/route.ts",
      "lib/notifications/index.ts",
    ]) {
      expect(rels.has(esperado), esperado).toBe(true)
    }
  })

  it("the reads that reach orders only through an embed are seen", () => {
    const de = (rel: string) => archivos.find((a) => a.rel === rel)?.lecturas ?? 0
    expect(de("app/api/clientes/[id]/route.ts")).toBeGreaterThan(0)
    expect(de("app/api/tecnicos/route.ts")).toBeGreaterThan(0)
    expect(de("app/api/garantias/route.ts")).toBeGreaterThan(0)
  })

  it("the embed another file exports is followed, and the tables a cron names to a generic reader are seen", () => {
    const de = (rel: string) => archivos.find((a) => a.rel === rel)?.lecturas ?? 0
    expect(globales.get("NC_ORDEN_ESTADO_EMBED")).toBe("ordenes_servicio(estado)")
    // one read of the orders table in the report and one of the embed through the constant
    expect(de("app/api/reportes/estado-resultados/route.ts")).toBeGreaterThan(
      archivos.find((a) => a.rel === "app/api/reportes/estado-resultados/route.ts")!.src.match(/from\("ordenes_servicio"\)/g)!.length,
    )
    for (const cron of ["auto-archive-dormant", "feature-usage", "lifecycle-emails", "re-engagement", "trial-management"]) {
      expect(de(`app/api/cron/${cron}/route.ts`), cron).toBeGreaterThan(0)
    }
  })

  it("every approved helper is exported by the module that defines it", () => {
    const fuente = (rel: string) => leerFuentes([], [rel])[0]?.src ?? ""
    const exportados = [
      ...fuente("lib/sucursal-ordenes.ts").matchAll(/export (?:async )?function (\w+)/g),
      ...fuente("lib/ordenes/alcance.ts").matchAll(/export (?:async )?function (\w+)/g),
      ...fuente("lib/ordenes/alcance-lectura.ts").matchAll(/export (?:async )?function (\w+)/g),
    ].map((m) => m[1])
    const funciones = [...ENVOLTURAS.filter((e) => !["aplicar", "aplicarAEmbed"].includes(e)), ...FILTROS, ...SOLO_DEFINIDAS]
    expect(funciones.filter((a) => !exportados.includes(a))).toEqual([])
    // the door's methods are members of the scope it returns
    const puerta = fuente("lib/ordenes/alcance-lectura.ts")
    for (const metodo of ["aplicar", "aplicarAEmbed"]) expect(puerta, metodo).toMatch(new RegExp(`\\b${metodo}<Q>\\(`))
  })

  it("PENDIENTE_PR5B is empty: the reads of the technician views and counts, money and reports are all scoped", () => {
    expect([...PENDIENTE_PR5B.keys()]).toEqual([])
  })

  it("a file is in at most one list, and every listed file exists", () => {
    const todos = LISTAS.flatMap(([, lista]) => [...lista.keys()])
    expect(todos.filter((f, i) => todos.indexOf(f) !== i)).toEqual([])
    const rels = new Set(archivos.map((a) => a.rel))
    expect(todos.filter((f) => !rels.has(f))).toEqual([])
  })

  it.each(LISTAS)("%s: each file has exactly the listed number of loose reads", (_nombre, lista) => {
    const descuadres = [...lista].flatMap(([rel, { sitios }]) => {
      const lineas = archivos.find((a) => a.rel === rel)?.sueltas ?? []
      return lineas.length === sitios ? [] : [`${rel}: listed ${sitios}, found ${lineas.length} (line ${lineas.join(", ")})`]
    })
    expect(descuadres).toEqual([])
  })

  it("every read of an order is scoped by a helper or listed with its reason", () => {
    const listados = new Set(LISTAS.flatMap(([, lista]) => [...lista.keys()]))
    const ofensores = archivos
      .filter(({ rel, sueltas }) => sueltas.length > 0 && !listados.has(rel))
      .map(({ rel, sueltas }) => `${rel} (line ${sueltas.join(", ")})`)
      .sort()
    expect(ofensores).toEqual([])
  })
})
