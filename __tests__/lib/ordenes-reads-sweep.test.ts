// @vitest-environment node
/**
 * Sweep (change sucursales-aislamiento, PR5; OI-1, SC-2, XC-1): every read of `ordenes_servicio`
 * either goes through a branch-scope helper or is listed, with its reason, in one of the lists below.
 *
 * On the syntax tree, not on text. A READ is
 *  - a query that starts `.from("ordenes_servicio")` and is not a write, or one whose use cannot be seen;
 *  - a `.select(..)` whose columns EMBED the table (`ordenes_servicio(..)`, `alias:ordenes_servicio(..)`,
 *    `ordenes_servicio!inner(..)`, `ordenes_servicio!fk(..)`, `ordenes_servicio:fk_column(..)`): the
 *    orders reach the caller through another table.
 *
 * A read counts as scoped only when a helper is APPLIED TO THAT read, one helper call per read:
 *  (A) a filter builder (`filtroVisibleEnSucursal`, `filtroAtiendeSucursal`, `filtroListaTecnico`), or, for
 *      an embed, a filter on the embed's `sucursal_id` / `tecnico_id`, sits inside the read's own chain;
 *  (B) the chain is an argument of a wrapper (`soloAtendidasPor`, `soloOriginadasEn`, the door's
 *      `.aplicar` / `.aplicarAEmbed`);
 *  (C) the chain is held in a variable that a wrapper (or an embed filter) receives.
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
const ENVOLTURAS = ["soloAtendidasPor", "soloOriginadasEn", "aplicar", "aplicarAEmbed"]
/** Builders of the filter string a read applies inside its own chain (`.or(filtroX(..))`). */
const FILTROS = ["filtroVisibleEnSucursal", "filtroAtiendeSucursal", "filtroListaTecnico"]
/** Approved but never applied by being called: the order loader reads at its call site, the door factory hands out the scope. */
const SOLO_DEFINIDAS = ["cargarOrdenEnAlcance", "alcanceLecturaOrdenes"]

const ESCRITURAS = ["insert", "update", "upsert", "delete"]
/** A column of an embed that scopes it by branch or by technician. */
const COLUMNAS_DE_ALCANCE = ["sucursal_id", "tecnico_id"]

interface Lectura {
  linea: number
  posicion: number
  /** Where the read starts: the `.from(..)` call, or the `.select(..)` call of an embed. */
  desde: ts.Node
  /** The nearest function (or the file) that holds the read. */
  contenedor: ts.Node
  /** The names (aliases) under which the table is embedded; empty for a query that starts on the table. */
  embeds: string[]
}

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

/** The source of a `.select(..)` argument; an identifier is followed to the `const` it names in the same file. */
function textoDelSelect(arg: ts.Node, sf: ts.SourceFile): string {
  const base = desenvolver(arg)
  if (ts.isIdentifier(base)) {
    let encontrado: string | null = null
    const buscar = (n: ts.Node) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === base.text && n.initializer) {
        encontrado = n.initializer.getText(sf)
      }
      if (encontrado === null) ts.forEachChild(n, buscar)
    }
    buscar(sf)
    if (encontrado !== null) return encontrado
  }
  return arg.getText(sf)
}

/** The names under which a select list embeds `ordenes_servicio` (an alias, or the table's own name). */
function embedsDeOrdenes(columnas: string): string[] {
  const nombres: string[] = []
  const patron = /(?<![\w.])(?:(\w+)\s*:\s*)?ordenes_servicio((?:\s*[:!]\s*\w+)*)\s*\(/g
  for (const m of columnas.matchAll(patron)) nombres.push(m[1] ?? "ordenes_servicio")
  return nombres
}

function analizar(src: string, rel = "x.ts"): { sf: ts.SourceFile; lecturas: Lectura[] } {
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const lecturas: Lectura[] = []
  const contenedorDe = (n: ts.Node) => {
    let contenedor: ts.Node = n.parent
    while (!esFuncion(contenedor) && !ts.isSourceFile(contenedor)) contenedor = contenedor.parent
    return contenedor
  }
  const registrar = (n: ts.Node, embeds: string[]) =>
    lecturas.push({ linea: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, posicion: n.getStart(sf), desde: n, contenedor: contenedorDe(n), embeds })

  const visitar = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.arguments[0]) {
      const nombre = n.expression.name.text
      if (nombre === "from" && textoDe(n.arguments[0]) === "ordenes_servicio") {
        const padre = n.parent
        const metodo = ts.isPropertyAccessExpression(padre) && padre.expression === n ? padre.name.text : null
        if (metodo === null || !ESCRITURAS.includes(metodo)) registrar(n, [])
      }
      if (nombre === "select") {
        const embeds = embedsDeOrdenes(textoDelSelect(n.arguments[0], sf))
        if (embeds.length > 0) registrar(n, embeds)
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
 * through the table it hangs from (`.eq("facturas.ordenes_servicio.sucursal_id", ..)`).
 */
function esFiltroDeEmbed(llamada: ts.CallExpression, embeds: string[]): boolean {
  if (!ts.isPropertyAccessExpression(llamada.expression) || !llamada.arguments[0]) return false
  const columna = textoDe(llamada.arguments[0])
  if (columna === null) return false
  return embeds.some((e) => COLUMNAS_DE_ALCANCE.some((c) => columna === `${e}.${c}` || columna.endsWith(`.${e}.${c}`)))
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

  // (A) a filter builder, or a filter on the embed's branch / technician column, inside the chain.
  salida.push(
    ...llamadasDentro(tope, (c) => {
      const nombre = nombreDeLlamada(c)
      return (nombre !== null && FILTROS.includes(nombre)) || (lectura.embeds.length > 0 && esFiltroDeEmbed(c, lectura.embeds))
    }),
  )

  // (B) the chain is the query argument of a wrapper.
  let actual: ts.Node = tope
  while (actual.parent && esTransparente(actual.parent) && actual.parent.expression === actual) actual = actual.parent
  const padre = actual.parent
  if (padre && ts.isCallExpression(padre) && padre.arguments[0] === actual) {
    const nombre = nombreDeLlamada(padre)
    if (nombre !== null && ENVOLTURAS.includes(nombre)) salida.push(padre)
  }

  // (C) the chain is held in a variable that a wrapper receives, or whose embed is filtered.
  const variable = variableDeLaCadena(tope)
  if (variable !== null) {
    salida.push(
      ...llamadasDentro(lectura.contenedor, (c) => {
        const nombre = nombreDeLlamada(c)
        if (nombre !== null && ENVOLTURAS.includes(nombre) && c.arguments[0]) return raizDeLaCadena(c.arguments[0]) === variable
        if (lectura.embeds.length > 0 && esFiltroDeEmbed(c, lectura.embeds)) {
          return ts.isPropertyAccessExpression(c.expression) && raizDeLaCadena(c.expression.expression) === variable
        }
        return false
      }),
    )
  }
  return salida
}

/** The reads of a source file that are not covered by a helper applied to them: the ones that need a listing. */
function sinAlcance(src: string, rel = "x.ts"): number[] {
  const { lecturas } = analizar(src, rel)
  const gastadas = new Set<ts.Node>()
  const sueltas: number[] = []
  for (const lectura of lecturas) {
    const libre = candidatas(lectura).find((c) => !gastadas.has(c))
    if (libre) gastadas.add(libre)
    else sueltas.push(lectura.linea)
  }
  return sueltas.sort((a, b) => a - b)
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

const EXENTOS: Listado = new Map([
  ["app/(dashboard)/dashboard/page.tsx", { sitios: 1, motivo: `the technician's cards: ${ASIGNADAS}` }],
  ["app/api/cron/engagement/route.ts", { sitios: 2, motivo: CRON }],
  ["app/api/cron/recordatorios/route.ts", { sitios: 1, motivo: CRON }],
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
  ["app/api/sucursales/[id]/route.ts", { sitios: 1, motivo: "count of the orders of a branch before it is deleted (ADMIN only)" }],
  ["app/api/tipos-dispositivo/[id]/route.ts", { sitios: 1, motivo: "count of the orders of a device type before it is deleted (ADMIN only)" }],
  ["app/api/usuarios/[id]/sucursal/route.ts", { sitios: 1, motivo: "open orders assigned to a user, to warn before moving him (ADMIN only)" }],
  ["app/api/ventas/[id]/garantia/[garantiaId]/pdf/route.ts", { sitios: 1, motivo: "the signature image of the user who delivered, for the warranty PDF of a sale; not a list of orders" }],
  // The next ones join the order of a money row to learn its organization, client or branch.
  // No order data comes back: they follow the money rule (the origin branch), not the order list.
  ["app/api/caja/movimientos/metodo-pago/route.ts", { sitios: 2, motivo: "joins the order of a collection or of an invoice payment only for its branch (the origin) that the handler checks; nothing else of the order is read" }],
  ["app/api/facturacion/[id]/route.ts", { sitios: 2, motivo: "invoice by id (void, delete): joins the order for its organization, client and branch (the origin), to re-credit the client account there; no order data is returned" }],
  ["app/api/pagos/route.ts", { sitios: 1, motivo: "payment of an invoice by id: joins the order for its organization, client and branch (the origin); no order data is returned" }],
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

// Reads that PR5b scopes (technician views and counts, invoicing candidates, pending orders of a client, receptions, reports...).
const PENDIENTE_PR5B: Listado = new Map([
  ["app/api/caja/route.ts", { sitios: 1, motivo: "orders pending collection on the cash screen: money, follows the origin" }],
  ["app/api/clientes/[id]/ordenes-pendientes/route.ts", { sitios: 1, motivo: "pending orders of a client: money, follows the origin" }],
  ["app/api/facturacion/candidatos/route.ts", { sitios: 1, motivo: "orders that can be invoiced: money, follows the origin" }],
  ["app/api/recepciones/[id]/route.ts", { sitios: 2, motivo: "the orders of a multi-device reception: the reception's branch" }],
  ["app/api/recepciones/[id]/entregar/route.ts", { sitios: 1, motivo: "the orders of a multi-device reception: the reception's branch" }],
  ["app/api/tecnicos/route.ts", { sitios: 1, motivo: "open-order counts of the technicians list (an embed of his orders)" }],
  ["app/api/tecnicos/summary/route.ts", { sitios: 1, motivo: "technician summary" }],
  ["app/api/tecnicos/[id]/route.ts", { sitios: 2, motivo: "open-order counts of a technician (an embed of his orders)" }],
  ["app/api/tecnicos/[id]/estado/route.ts", { sitios: 1, motivo: "open-order count of a technician (an embed of his orders)" }],
  ["app/api/tecnicos/[id]/ordenes/route.ts", { sitios: 1, motivo: "orders of a technician" }],
  ["app/api/tecnicos/[id]/insights/route.ts", { sitios: 1, motivo: "technician insights" }],
  ["app/api/tecnicos/[id]/reasignar/route.ts", { sitios: 1, motivo: "bulk reassignment" }],
  ["lib/notas-credito/documento.ts", { sitios: 1, motivo: "the order behind a credit note document" }],
  ["app/api/reportes/estado-resultados/route.ts", { sitios: 1, motivo: "report" }],
  ["app/api/reportes/fallas-comunes/route.ts", { sitios: 1, motivo: "report" }],
  ["app/api/reportes/performance-tecnicos/route.ts", { sitios: 1, motivo: "report" }],
  ["app/api/reportes/rentabilidad-tecnicos/route.ts", { sitios: 1, motivo: "report" }],
  ["app/api/reportes/rentabilidad/route.ts", { sitios: 1, motivo: "report" }],
  ["app/api/reportes/tasa-retorno/route.ts", { sitios: 1, motivo: "report" }],
  ["app/api/reportes/tendencia-financiera/route.ts", { sitios: 1, motivo: "report" }],
  ["app/api/reportes/tiempo-reparacion/route.ts", { sitios: 1, motivo: "report" }],
  ["app/api/reportes/top-clientes/route.ts", { sitios: 1, motivo: "report" }],
])

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
const sueltas = (src: string) => sinAlcance(`export async function GET() {\n${src}\n}`).map((l) => l - 1)

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
})

describe("source tree", () => {
  const archivos = leerFuentes(["app", "lib", "components", "hooks", "contexts"])
    .filter(({ src }) => src.includes("ordenes_servicio"))
    .map(({ rel, src }) => ({ rel, src, sueltas: sinAlcance(src, rel), lecturas: analizar(src, rel).lecturas.length }))

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
