// @vitest-environment node
/**
 * Sweep: every handler of the single-quote routes (app/api/cotizaciones/[id] and its sub-routes)
 * applies the branch scope of the order the quote is linked to, or is listed in EXENTOS with the reason
 * it does not need to. Same idea as ordenes-subroutes-sweep.test.ts, for quotes.
 *
 * Handler by handler, on the syntax tree: the handler must resolve the scope with
 * `resolverAlcanceOrdenesPorId`, answer 404 when `cotizacionEnAlcance` says no, and do both before it
 * writes anything or calls an RPC. A new sub-route (or a new method on one) fails here until it is wired
 * or exempted with a reason; the exact set of handlers is pinned below.
 */
import { describe, it, expect } from "vitest"
import ts from "typescript"
import { leerFuentes } from "../helpers/fuentes"
import { ESCRITURAS, manejadores, nodos, type Manejador } from "../helpers/manejadores-ruta"

/** Any dynamic segment under app/api/cotizaciones: `[id]` today, whatever it is called tomorrow. */
const RUTA = /^app\/api\/cotizaciones\/(\[[^/\]]+\](?:\/.+)?)\/route\.ts$/

/** Every handler there is today, as `<route under app/api/cotizaciones>#<METHOD>`. Adding one is a decision. */
const MANEJADORES_ESPERADOS = [
  "[id]#DELETE",
  "[id]#GET",
  "[id]#PUT",
  "[id]/aprobar#POST",
  "[id]/convertir-orden#POST",
  "[id]/convertir-venta#POST",
  "[id]/duplicar#POST",
  "[id]/enviar#POST",
  "[id]/historial#GET",
  "[id]/pdf#GET",
  "[id]/revisar#POST",
]

// Handlers that do not apply the scope, and why that is safe. Each must refuse every non-ADMIN before it
// touches the database, and an ADMIN's scope is the whole organization.
const EXENTOS = new Map<string, string>([
  ["[id]#DELETE", "ADMIN only: the role check comes first and answers 403; an ADMIN's scope is every branch"],
  ["[id]/convertir-orden#POST", "ADMIN only: the role check comes first and answers 403; an ADMIN's scope is every branch"],
  ["[id]/revisar#POST", "ADMIN only: requireAdmin() comes first and its refusal is returned; an ADMIN's scope is every branch"],
])

const llamaA = (n: ts.Node, nombre: string): n is ts.CallExpression =>
  ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === nombre

const esEscritura = (n: ts.Node) =>
  ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ESCRITURAS.includes(n.expression.name.text)

/** `supabaseAdmin` anywhere, or any `.rpc`: the first thing a handler does with the database. */
const tocaLaBase = (n: ts.Node) =>
  (ts.isIdentifier(n) && n.text === "supabaseAdmin") || (ts.isPropertyAccessExpression(n) && n.name.text === "rpc")

/** `!cotizacionEnAlcance(...)` */
const esNegacionDelAlcance = (n: ts.Node) =>
  ts.isPrefixUnaryExpression(n) &&
  n.operator === ts.SyntaxKind.ExclamationToken &&
  llamaA(ts.isParenthesizedExpression(n.operand) ? n.operand.expression : n.operand, "cotizacionEnAlcance")

/** What is wrong with a handler that is supposed to apply the scope. */
function problemasDelAlcance(m: Manejador): string[] {
  if (m.opaco) return [`cannot be checked: ${m.opaco}`]
  if (!m.nodo) return ["has no body to check"]
  const todos = nodos(m.nodo)

  const resolver = todos.find((n) => llamaA(n, "resolverAlcanceOrdenesPorId"))
  if (!resolver) return ["does not call resolverAlcanceOrdenesPorId"]
  if (!resolver.parent || !ts.isAwaitExpression(resolver.parent)) return ["calls resolverAlcanceOrdenesPorId without awaiting it"]

  const guarda = todos.find(
    (n): n is ts.IfStatement => ts.isIfStatement(n) && [n.expression, ...nodos(n.expression)].some(esNegacionDelAlcance),
  )
  if (!guarda) return ["does not refuse when cotizacionEnAlcance is false"]

  const problemas: string[] = []
  const refusa = [guarda.thenStatement, ...nodos(guarda.thenStatement)]
  if (!refusa.some(ts.isReturnStatement) || !/\b404\b/.test(guarda.thenStatement.getText())) {
    problemas.push("the scope check does not return a 404")
  }
  if (resolver.pos > guarda.pos) problemas.push("resolves the scope after the scope check")
  if (todos.some((n) => n.pos < guarda.pos && esEscritura(n))) problemas.push("writes before the scope check")
  return problemas
}

/** What is wrong with an exempt handler: the admin-only check must come first. */
function problemasDeLaExencion(m: Manejador): string[] {
  if (m.opaco || !m.nodo) return [`cannot be checked: ${m.opaco ?? "no body"}`]
  const todos = nodos(m.nodo)
  if (todos.some((n) => llamaA(n, "cotizacionEnAlcance"))) return ["is exempt but applies the scope"]

  const rolAdmin = todos.find(
    (n): n is ts.IfStatement =>
      ts.isIfStatement(n) &&
      [n.expression, ...nodos(n.expression)].some(
        (e) =>
          ts.isBinaryExpression(e) &&
          e.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken &&
          ts.isIdentifier(e.left) &&
          e.left.text === "role" &&
          ts.isStringLiteral(e.right) &&
          e.right.text === "ADMIN",
      ),
  )
  if (rolAdmin) {
    const problemas: string[] = []
    if (!/\b403\b/.test(rolAdmin.thenStatement.getText())) problemas.push("the role check does not answer 403")
    const base = todos.find(tocaLaBase)
    if (base && base.pos < rolAdmin.pos) problemas.push("touches the database before the role check")
    return problemas
  }

  const admin = todos.find((n) => llamaA(n, "requireAdmin"))
  if (!admin) return ['has no `role !== "ADMIN"` check and does not call requireAdmin']
  const problemas: string[] = []
  if (!admin.parent || !ts.isAwaitExpression(admin.parent)) problemas.push("calls requireAdmin without awaiting it")
  const sale = todos.find(
    (n): n is ts.IfStatement =>
      ts.isIfStatement(n) && ts.isIdentifier(n.expression) && n.expression.text === "error" && nodos(n.thenStatement).concat(n.thenStatement).some(ts.isReturnStatement),
  )
  if (!sale) problemas.push("does not return the requireAdmin refusal")
  const base = todos.find(tocaLaBase)
  if (base && base.pos < admin.pos) problemas.push("touches the database before requireAdmin")
  return problemas
}

/** Everything a sweep over one route file reports, by `<route>#<METHOD>`. */
function evaluar(ruta: string, src: string): Array<{ clave: string; problemas: string[] }> {
  return manejadores(src).map((m) => {
    const clave = `${ruta}#${m.metodo}`
    return { clave, problemas: EXENTOS.has(clave) ? problemasDeLaExencion(m) : problemasDelAlcance(m) }
  })
}

describe("detector, with planted offenders", () => {
  const evalua = (src: string, ruta = "[id]/x") => evaluar(ruta, src)
  const BIEN = `
    export async function GET() {
      const alcance = await resolverAlcanceOrdenesPorId({ role, userId, userSucursalId })
      const { data } = await supabaseAdmin.from("cotizaciones").select("*")
      if (!data || !cotizacionEnAlcance(alcance, data)) {
        return NextResponse.json({ error: "x" }, { status: 404 })
      }
      await supabaseAdmin.from("cotizaciones").update({ a: 1 })
    }`

  it("accepts a handler that resolves the scope, refuses with 404, and only then writes", () => {
    expect(evalua(BIEN)).toEqual([{ clave: "[id]/x#GET", problemas: [] }])
  })

  it.each([
    ["a function declaration", `export async function GET() { await supabaseAdmin.from("c").update({}) }`],
    ["a const arrow function", `export const GET = async () => { await supabaseAdmin.from("c").update({}) }`],
    ["a const wrapped in another call", `export const GET = conAuth(async () => { await supabaseAdmin.from("c").update({}) })`],
    ["a local function exported under its method name", `async function lista() { await supabaseAdmin.from("c").update({}) }\nexport { lista as GET }`],
  ])("flags %s that never resolves the scope", (_forma, src) => {
    expect(evalua(src)[0].problemas, src).toEqual(["does not call resolverAlcanceOrdenesPorId"])
  })

  it.each([
    ["a re-export of a handler", `export { GET } from "./otra-ruta"`],
    ["an `export *`", `export * from "./otra-ruta"`],
    ["a handler exported by destructuring", `export const { GET } = handlers`],
  ])("flags %s: it cannot be checked", (_forma, src) => {
    expect(evalua(src)[0].problemas[0], src).toMatch(/^cannot be checked/)
  })

  it("is not fooled by the calls in a comment or in a string", () => {
    const src = `
      export async function GET() {
        // const a = await resolverAlcanceOrdenesPorId({})
        /* if (!cotizacionEnAlcance(a, c)) return x(404) */
        const t = "resolverAlcanceOrdenesPorId cotizacionEnAlcance"
        await supabaseAdmin.from("c").update({})
      }`
    expect(evalua(src)[0].problemas).toEqual(["does not call resolverAlcanceOrdenesPorId"])
  })

  it("does not credit a handler with the call of a neighbour", () => {
    const src = `
      export async function GET() { await supabaseAdmin.from("c").select("id") }
      export async function POST() {
        const a = await resolverAlcanceOrdenesPorId({})
        if (!cotizacionEnAlcance(a, c)) { return x(404) }
      }`
    expect(evaluar("[id]/x", src).map((r) => [r.clave, r.problemas.length])).toEqual([
      ["[id]/x#GET", 1],
      ["[id]/x#POST", 0],
    ])
  })

  it("flags a scope that is resolved but never enforced", () => {
    const src = `export async function GET() { const a = await resolverAlcanceOrdenesPorId({}); return ok(a) }`
    expect(evalua(src)[0].problemas).toEqual(["does not refuse when cotizacionEnAlcance is false"])
  })

  it("flags a resolver that is not awaited", () => {
    const src = `export async function GET() { const a = resolverAlcanceOrdenesPorId({}); if (!cotizacionEnAlcance(a, c)) { return x(404) } }`
    expect(evalua(src)[0].problemas).toEqual(["calls resolverAlcanceOrdenesPorId without awaiting it"])
  })

  it("flags a refusal that is not a 404 or does not return", () => {
    const otro = `export async function GET() { const a = await resolverAlcanceOrdenesPorId({}); if (!cotizacionEnAlcance(a, c)) { return x(403) } }`
    const noRetorna = `export async function GET() { const a = await resolverAlcanceOrdenesPorId({}); if (!cotizacionEnAlcance(a, c)) { log(404) } }`
    expect(evalua(otro)[0].problemas).toEqual(["the scope check does not return a 404"])
    expect(evalua(noRetorna)[0].problemas).toEqual(["the scope check does not return a 404"])
  })

  it.each([
    ["an update", `await supabaseAdmin.from("c").update({})`],
    ["an insert", `await supabaseAdmin.from("c").insert({})`],
    ["a delete", `await supabaseAdmin.from("c").delete()`],
    ["an rpc", `await supabaseAdmin.rpc("hacer", {})`],
  ])("flags %s that runs before the scope check", (_caso, escritura) => {
    const src = `export async function POST() {
      const a = await resolverAlcanceOrdenesPorId({})
      ${escritura}
      if (!cotizacionEnAlcance(a, c)) { return x(404) }
    }`
    expect(evalua(src)[0].problemas).toEqual(["writes before the scope check"])
  })

  it("lets a handler read before the scope check", () => {
    const src = `export async function GET() {
      const a = await resolverAlcanceOrdenesPorId({})
      const { data } = await supabaseAdmin.from("c").select("*").single()
      if (!cotizacionEnAlcance(a, data)) { return x(404) }
    }`
    expect(evalua(src)[0].problemas).toEqual([])
  })

  describe("exemptions", () => {
    const exento = (cuerpo: string) => evaluar("[id]", `export async function DELETE() {\n${cuerpo}\n}`)[0].problemas

    it("accepts the role check first, answering 403", () => {
      expect(exento(`if (role !== "ADMIN") { return NextResponse.json({}, { status: 403 }) }\n await supabaseAdmin.from("c").delete()`)).toEqual([])
    })

    it("accepts requireAdmin first, with its refusal returned", () => {
      expect(exento(`const { error } = await requireAdmin()\n if (error) return error\n await supabaseAdmin.from("c").delete()`)).toEqual([])
    })

    it("flags a handler with no admin check", () => {
      expect(exento(`await supabaseAdmin.from("c").delete()`)).toEqual(['has no `role !== "ADMIN"` check and does not call requireAdmin'])
    })

    it("flags a role check that comes after the database", () => {
      expect(
        exento(`await supabaseAdmin.from("c").select("id")\n if (role !== "ADMIN") { return NextResponse.json({}, { status: 403 }) }`),
      ).toEqual(["touches the database before the role check"])
    })

    it("flags a role check that does not answer 403", () => {
      expect(exento(`if (role !== "ADMIN") { return NextResponse.json({}, { status: 401 }) }`)).toEqual(["the role check does not answer 403"])
    })

    it("flags requireAdmin whose refusal is not returned, or that comes after the database", () => {
      expect(exento(`await requireAdmin()\n await supabaseAdmin.from("c").delete()`)).toEqual(["does not return the requireAdmin refusal"])
      expect(exento(`await supabaseAdmin.from("c").select("id")\n const { error } = await requireAdmin()\n if (error) return error`)).toEqual([
        "touches the database before requireAdmin",
      ])
    })

    it("flags an exempt handler that applies the scope (the exemption is stale)", () => {
      expect(exento(`const a = await resolverAlcanceOrdenesPorId({}); if (!cotizacionEnAlcance(a, c)) { return x(404) }`)).toEqual([
        "is exempt but applies the scope",
      ])
    })
  })
})

describe("source tree", () => {
  const archivos = leerFuentes(["app/api/cotizaciones"]).filter((a) => RUTA.test(a.rel))
  const rutaDe = (rel: string) => RUTA.exec(rel)![1]
  const evaluados = archivos.flatMap((a) => evaluar(rutaDe(a.rel), a.src))

  it("finds exactly the handlers the sweep knows about", () => {
    expect(evaluados.map((e) => e.clave).sort()).toEqual([...MANEJADORES_ESPERADOS].sort())
  })

  it("every handler applies the branch scope of its quote, or is exempt with a reason", () => {
    const mal = evaluados.filter((e) => e.problemas.length > 0).map((e) => `${e.clave}: ${e.problemas.join("; ")}`)

    expect(mal).toEqual([])
  })

  it("every exemption names a handler that exists, with a reason", () => {
    const existentes = new Set(evaluados.map((e) => e.clave))

    for (const [clave, motivo] of EXENTOS) {
      expect(existentes.has(clave), `${clave} does not exist`).toBe(true)
      expect(motivo.length, clave).toBeGreaterThan(20)
    }
  })
})
