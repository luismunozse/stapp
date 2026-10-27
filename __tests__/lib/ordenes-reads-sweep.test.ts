// @vitest-environment node
/**
 * Sweep (change sucursales-aislamiento, PR5; OI-1, SC-2, XC-1): every read of `ordenes_servicio`
 * either goes through a branch-scope helper or is listed, with its reason, in one of the lists below.
 *
 * On the syntax tree, not on text, and per function: a read counts as scoped when the function that
 * holds it calls an approved helper (the helpers of lib/sucursal-ordenes, the order loader, or the
 * door for lists) at least once per read in that function. A read in a function that calls none, or a
 * second read next to a single helper call, is reported. A new route that reads orders without branch
 * handling therefore fails here until it is wired or listed with a reason.
 *
 * Only READS are swept (a chain that starts `.from("ordenes_servicio").select`, or one whose use
 * cannot be seen). Writes by id are covered by the handler sweep of the order routes
 * (ordenes-subroutes-sweep.test.ts).
 *
 * The lists carry the exact number of reads per file, so a stale entry (the file now has fewer, or
 * more) fails too:
 *  - EXENTOS: reads that do not need the helpers, and why.
 *  - PENDIENTE_*: reads that a later change of this series scopes; each such change empties its list.
 */
import { describe, it, expect } from "vitest"
import ts from "typescript"
import { leerFuentes } from "../helpers/fuentes"

/** Helpers that scope an orders query (or a single order) to a branch. */
const AYUDANTES = [
  "soloAtendidasPor",
  "soloOriginadasEn",
  "filtroVisibleEnSucursal",
  "filtroAtiendeSucursal",
  "filtroListaTecnico",
  "cargarOrdenEnAlcance",
  "alcanceLecturaOrdenes",
]

const ESCRITURAS = ["insert", "update", "upsert", "delete"]

interface Lectura {
  linea: number
  /** The method chained right after `.from(...)`; null when the chain is not visible there. */
  metodo: string | null
  /** The nearest function (or the file) that holds the read. */
  contenedor: ts.Node
}

const esFuncion = (n: ts.Node) =>
  ts.isFunctionDeclaration(n) ||
  ts.isFunctionExpression(n) ||
  ts.isArrowFunction(n) ||
  ts.isMethodDeclaration(n) ||
  ts.isGetAccessor(n) ||
  ts.isSetAccessor(n) ||
  ts.isConstructorDeclaration(n)

const textoDe = (n: ts.Node): string | null =>
  ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ? n.text : null

function analizar(src: string, rel = "x.ts"): { sf: ts.SourceFile; lecturas: Lectura[] } {
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const lecturas: Lectura[] = []
  const visitar = (n: ts.Node) => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === "from" &&
      n.arguments[0] &&
      textoDe(n.arguments[0]) === "ordenes_servicio"
    ) {
      const padre = n.parent
      const metodo = ts.isPropertyAccessExpression(padre) && padre.expression === n ? padre.name.text : null
      if (metodo === null || !ESCRITURAS.includes(metodo)) {
        let contenedor: ts.Node = n.parent
        while (!esFuncion(contenedor) && !ts.isSourceFile(contenedor)) contenedor = contenedor.parent
        lecturas.push({ linea: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, metodo, contenedor })
      }
    }
    ts.forEachChild(n, visitar)
  }
  visitar(sf)
  return { sf, lecturas }
}

/** The calls to an approved helper in the body of `raiz` itself: the functions nested in it have their own. */
function llamadasPropias(raiz: ts.Node): number {
  let cuenta = 0
  const visitar = (n: ts.Node) => {
    if (esFuncion(n)) return
    if (ts.isCallExpression(n)) {
      const f = n.expression
      const nombre = ts.isIdentifier(f) ? f.text : ts.isPropertyAccessExpression(f) ? f.name.text : null
      if (nombre && AYUDANTES.includes(nombre)) cuenta++
    }
    ts.forEachChild(n, visitar)
  }
  ts.forEachChild(raiz, visitar)
  return cuenta
}

/**
 * The helper calls that cover the reads of a function: the ones in its own body and the ones in the
 * bodies of the functions around it (a callback that reads inside a handler that already scoped).
 */
function llamadasQueCubren(contenedor: ts.Node): number {
  let cuenta = 0
  for (let n: ts.Node | undefined = contenedor; n; n = n.parent) {
    if (esFuncion(n) || ts.isSourceFile(n)) cuenta += llamadasPropias(n)
  }
  return cuenta
}

/** The reads of a source file that are not covered by a helper: the ones that need a listing. */
function sinAlcance(src: string, rel = "x.ts"): number[] {
  const { lecturas } = analizar(src, rel)
  const porFuncion = new Map<ts.Node, Lectura[]>()
  for (const l of lecturas) porFuncion.set(l.contenedor, [...(porFuncion.get(l.contenedor) ?? []), l])
  const salida: number[] = []
  for (const [contenedor, lista] of porFuncion) {
    const cubiertas = llamadasQueCubren(contenedor)
    // The helpers cover the first `cubiertas` reads of the function; any read beyond that is loose.
    lista.slice(cubiertas).forEach((l) => salida.push(l.linea))
  }
  return salida.sort((a, b) => a - b)
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
  ["lib/counters.ts", { sitios: 1, motivo: "the highest order number of the organization, to allocate the next one" }],
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
])

// Reads that PR5b scopes (technician views, invoicing candidates, pending orders of a client, reports...).
const PENDIENTE_PR5B: Listado = new Map([
  ["app/api/caja/route.ts", { sitios: 1, motivo: "orders pending collection on the cash screen: money, follows the origin" }],
  ["app/api/clientes/[id]/ordenes-pendientes/route.ts", { sitios: 1, motivo: "pending orders of a client: money, follows the origin" }],
  ["app/api/facturacion/candidatos/route.ts", { sitios: 1, motivo: "orders that can be invoiced: money, follows the origin" }],
  ["app/api/recepciones/[id]/route.ts", { sitios: 2, motivo: "the orders of a multi-device reception: the reception's branch" }],
  ["app/api/recepciones/[id]/entregar/route.ts", { sitios: 1, motivo: "the orders of a multi-device reception: the reception's branch" }],
  ["app/api/tecnicos/summary/route.ts", { sitios: 1, motivo: "technician summary" }],
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

// Reads of quotes, warranties and commissions: scoped by the change that gives quotes a branch (PR20).
const PENDIENTE_PR20: Listado = new Map([
  ["app/api/cotizaciones/route.ts", { sitios: 1, motivo: "the order a quote is created for" }],
  ["app/api/cotizaciones/[id]/route.ts", { sitios: 5, motivo: "the order linked to a quote" }],
  ["app/api/cotizaciones/[id]/enviar/route.ts", { sitios: 1, motivo: "the order linked to a quote" }],
  ["app/api/cotizaciones/[id]/aprobar/route.ts", { sitios: 1, motivo: "the order linked to a quote" }],
  ["app/api/garantias/route.ts", { sitios: 1, motivo: "warranties of orders" }],
])

const LISTAS: Array<[string, Listado]> = [
  ["EXENTOS", EXENTOS],
  ["PENDIENTE_PR5B", PENDIENTE_PR5B],
  ["PENDIENTE_PR20", PENDIENTE_PR20],
]

describe("detector, with planted offenders", () => {
  it("reports a read in a function that calls no helper", () => {
    const src = `export async function GET() {\n  const { data } = await supabaseAdmin.from("ordenes_servicio").select("*").eq("organization_id", o)\n}`
    expect(sinAlcance(src)).toEqual([2])
  })

  it.each(AYUDANTES)("accepts a read next to a call to %s", (ayudante) => {
    const src = `export async function GET() {\n  let q = supabaseAdmin.from("ordenes_servicio").select("*")\n  q = ${ayudante}(q, s)\n}`
    expect(sinAlcance(src)).toEqual([])
  })

  it("accepts a helper called as a method (a namespace import)", () => {
    const src = `export async function GET() {\n  const q = supabaseAdmin.from("ordenes_servicio").select("*")\n  return ayudantes.soloAtendidasPor(q, s)\n}`
    expect(sinAlcance(src)).toEqual([])
  })

  it("does not take a helper called in ANOTHER function", () => {
    const src = `function a() { return soloAtendidasPor(q, s) }\nexport async function GET() {\n  return supabaseAdmin.from("ordenes_servicio").select("*")\n}`
    expect(sinAlcance(src)).toEqual([3])
  })

  it("does not take a helper that is only named in a comment or a string", () => {
    const src = `export async function GET() {\n  // soloAtendidasPor(q, s)\n  const x = "filtroVisibleEnSucursal()"\n  return supabaseAdmin.from("ordenes_servicio").select("*")\n}`
    expect(sinAlcance(src)).toEqual([4])
  })

  it("a second read next to one helper call is reported (reads beyond the helper calls are loose)", () => {
    const src = `export async function GET() {\n  const a = soloAtendidasPor(supabaseAdmin.from("ordenes_servicio").select("id"), s)\n  const b = await supabaseAdmin.from("ordenes_servicio").select("estado")\n}`
    expect(sinAlcance(src)).toEqual([3])
  })

  it("two reads with two helper calls pass", () => {
    const src = `export async function GET() {\n  const a = soloAtendidasPor(supabaseAdmin.from("ordenes_servicio").select("id"), s)\n  const b = soloOriginadasEn(supabaseAdmin.from("ordenes_servicio").select("estado"), s)\n}`
    expect(sinAlcance(src)).toEqual([])
  })

  it("a factory arrow is its own function: its helper does not cover the reads outside it", () => {
    const src = `export async function GET() {\n  const a = () => soloAtendidasPor(supabaseAdmin.from("ordenes_servicio").select("id"), s)\n  const b = await supabaseAdmin.from("ordenes_servicio").select("estado")\n}`
    expect(sinAlcance(src)).toEqual([3])
  })

  it("a callback that reads inside a handler that already called the helper is covered by it", () => {
    const src = `export async function GET() {\n  const f = filtroVisibleEnSucursal(s)\n  return ids.map(async (id) => supabaseAdmin.from("ordenes_servicio").select("*").or(f))\n}`
    expect(sinAlcance(src)).toEqual([])
  })

  it.each([
    ["insert", `supabaseAdmin.from("ordenes_servicio").insert({ a: 1 })`],
    ["update", `supabaseAdmin.from("ordenes_servicio").update({ a: 1 }).eq("id", x)`],
    ["upsert", `supabaseAdmin.from("ordenes_servicio").upsert({ a: 1 })`],
    ["delete", `supabaseAdmin.from("ordenes_servicio").delete().eq("id", x)`],
  ])("a %s is a write: not swept here", (_metodo, expr) => {
    expect(sinAlcance(`export async function POST() {\n  await ${expr}\n}`)).toEqual([])
  })

  it("a chain that is held in a variable before it is used cannot be seen: it counts as a read", () => {
    const src = `export async function GET() {\n  const q = supabaseAdmin.from("ordenes_servicio")\n  return q.select("*")\n}`
    expect(sinAlcance(src)).toEqual([2])
  })

  it.each([
    ["single quotes", `supabaseAdmin.from('ordenes_servicio').select('*')`],
    ["a template literal without substitutions", "supabaseAdmin.from(`ordenes_servicio`).select('*')"],
    ["another client variable", `db.from("ordenes_servicio").select("*")`],
  ])("detects the table written with %s", (_forma, expr) => {
    expect(sinAlcance(`export async function GET() {\n  return ${expr}\n}`)).toEqual([2])
  })

  it("a read at the top of the module is held by the file itself", () => {
    expect(sinAlcance(`const q = supabaseAdmin.from("ordenes_servicio").select("*")`)).toEqual([1])
    expect(sinAlcance(`const q = soloAtendidasPor(supabaseAdmin.from("ordenes_servicio").select("*"), s)`)).toEqual([])
  })

  it("ignores other tables", () => {
    expect(sinAlcance(`export async function GET() {\n  return supabaseAdmin.from("ventas").select("*")\n}`)).toEqual([])
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
    ]) {
      expect(rels.has(esperado), esperado).toBe(true)
    }
  })

  it("every approved helper is exported by the module that defines it", () => {
    const fuente = (rel: string) => leerFuentes([], [rel])[0]?.src ?? ""
    const exportados = [
      ...fuente("lib/sucursal-ordenes.ts").matchAll(/export (?:async )?function (\w+)/g),
      ...fuente("lib/ordenes/alcance.ts").matchAll(/export (?:async )?function (\w+)/g),
      ...fuente("lib/ordenes/alcance-lectura.ts").matchAll(/export (?:async )?function (\w+)/g),
    ].map((m) => m[1])
    expect(AYUDANTES.filter((a) => !exportados.includes(a))).toEqual([])
  })

  it("a file is in at most one list, and every listed file exists", () => {
    const todos = LISTAS.flatMap(([, lista]) => [...lista.keys()])
    expect(todos.filter((f, i) => todos.indexOf(f) !== i)).toEqual([])
    const rels = new Set(archivos.map((a) => a.rel))
    expect(todos.filter((f) => !rels.has(f))).toEqual([])
  })

  it.each(LISTAS)("%s: each file has exactly the listed number of loose reads", (_nombre, lista) => {
    const descuadres = [...lista].flatMap(([rel, { sitios }]) => {
      const real = archivos.find((a) => a.rel === rel)?.sueltas.length ?? 0
      return real === sitios ? [] : [`${rel}: listed ${sitios}, found ${real}`]
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
