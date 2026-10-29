// @vitest-environment node
/**
 * Sweep (change sucursales-aislamiento, PR3; XC-1, XC-2, OI-1, OI-2): every handler of the order
 * detail route and its sub-routes reads the order through `cargarOrdenEnAlcance`, or is listed in
 * EXENTOS with the reason it does not need to.
 *
 * Handler by handler, not file by file, and on the syntax tree, not on text: a route that scopes its
 * POST but forgets its GET is the kind of miss a file-level check lets through, and a handler can be
 * exported as a function, as a `const`, as `export { a as GET }` or re-exported from another module.
 * The call must sit in the handler's own body, be awaited, come before the handler reads or writes
 * anything, and its refusal must be returned. A new sub-route (or a new method on one) fails here
 * until it is wired or exempted with a reason; the exact set of handlers is pinned below.
 */
import { describe, it, expect } from "vitest"
import ts from "typescript"
import { leerFuentes } from "../helpers/fuentes"

/** Any dynamic segment under app/api/ordenes: `[id]` today, whatever it is called tomorrow. */
const RUTA = /^app\/api\/ordenes\/(\[[^/\]]+\](?:\/.+)?)\/route\.ts$/

/** Every handler there is today, as `<route under app/api/ordenes>#<METHOD>`. Adding one is a decision. */
const MANEJADORES_ESPERADOS = [
  "[id]#DELETE",
  "[id]#GET",
  "[id]#PUT",
  "[id]/checklist#DELETE",
  "[id]/checklist#GET",
  "[id]/checklist#POST",
  "[id]/checklist#PUT",
  "[id]/cobros#DELETE",
  "[id]/cobros#GET",
  "[id]/cobros#POST",
  "[id]/comprobante-entrega#GET",
  "[id]/cuotas#GET",
  "[id]/cuotas#PUT",
  "[id]/entregar#POST",
  "[id]/eventos#GET",
  "[id]/fotos#DELETE",
  "[id]/fotos#GET",
  "[id]/fotos#POST",
  "[id]/fotos/[fotoId]#GET",
  "[id]/notas-credito#GET",
  "[id]/pdf#GET",
  "[id]/reingreso#POST",
  "[id]/repuestos#DELETE",
  "[id]/repuestos#PATCH",
  "[id]/repuestos#POST",
  "[id]/servicios#DELETE",
  "[id]/servicios#PATCH",
  "[id]/servicios#POST",
  "[id]/tomar#POST",
]

// Handlers that do not call the loader, and why that is safe. Each one must check the role before it
// touches the database, and answer 403.
const EXENTOS = new Map<string, string>([
  [
    "[id]/cobros#DELETE",
    "ADMIN only: the role check comes first, so anybody else gets the same 403 for any id, and an ADMIN's scope is the whole organization",
  ],
  [
    "[id]/cuotas#PUT",
    "ADMIN only: the role check comes first, so anybody else gets the same 403 for any id, and an ADMIN's scope is the whole organization",
  ],
])

// Handlers that may read before the loader (never write), and why.
const LEE_ANTES_DEL_CARGADOR = new Map<string, string>([
  [
    "[id]/fotos#DELETE",
    "the photo is read to find the order it belongs to; nothing is written or returned before the loader",
  ],
])

const METODOS = ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]
const ESCRITURAS = ["insert", "update", "upsert", "delete", "rpc"]

interface Manejador {
  metodo: string
  /** The syntax node of the handler; null when it cannot be seen (re-exports). */
  nodo: ts.Node | null
  /** Why the handler cannot be checked, if it cannot. */
  opaco?: string
}

const tieneExport = (st: ts.Node) =>
  ts.canHaveModifiers(st) && !!ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)

/** The exported HTTP handlers of a route file, in whatever form they are exported. */
function manejadores(src: string): Manejador[] {
  const sf = ts.createSourceFile("route.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const locales = new Map<string, ts.Node>()
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) locales.set(st.name.text, st)
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer) locales.set(d.name.text, d.initializer)
      }
    }
  }

  const salida: Manejador[] = []
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && tieneExport(st) && st.name && METODOS.includes(st.name.text)) {
      salida.push({ metodo: st.name.text, nodo: st })
    } else if (ts.isVariableStatement(st) && tieneExport(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && METODOS.includes(d.name.text)) {
          salida.push({ metodo: d.name.text, nodo: d.initializer ?? null })
        } else if (ts.isObjectBindingPattern(d.name)) {
          for (const e of d.name.elements) {
            if (ts.isIdentifier(e.name) && METODOS.includes(e.name.text)) {
              salida.push({ metodo: e.name.text, nodo: null, opaco: "exported by destructuring" })
            }
          }
        }
      }
    } else if (ts.isExportDeclaration(st)) {
      if (!st.exportClause) {
        salida.push({ metodo: "*", nodo: null, opaco: "`export *` re-exports names this sweep cannot see" })
      } else if (ts.isNamedExports(st.exportClause)) {
        for (const e of st.exportClause.elements) {
          if (!METODOS.includes(e.name.text)) continue
          const local = (e.propertyName ?? e.name).text
          if (st.moduleSpecifier) salida.push({ metodo: e.name.text, nodo: null, opaco: "re-exported from another module" })
          else if (locales.has(local)) salida.push({ metodo: e.name.text, nodo: locales.get(local)! })
          else salida.push({ metodo: e.name.text, nodo: null, opaco: `exports \`${local}\`, which is not defined here` })
        }
      }
    }
  }
  return salida
}

/** Every node under `raiz`, in source order. */
function nodos(raiz: ts.Node): ts.Node[] {
  const lista: ts.Node[] = []
  const visitar = (n: ts.Node) => {
    lista.push(n)
    ts.forEachChild(n, visitar)
  }
  ts.forEachChild(raiz, visitar)
  return lista
}

const esLlamadaAlCargador = (n: ts.Node): n is ts.CallExpression =>
  ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "cargarOrdenEnAlcance"

/** `supabaseAdmin` anywhere, or any `.rpc`: the first thing a handler does with the database. */
const tocaLaBase = (n: ts.Node) =>
  (ts.isIdentifier(n) && n.text === "supabaseAdmin") || (ts.isPropertyAccessExpression(n) && n.name.text === "rpc")

const esEscritura = (n: ts.Node) =>
  ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ESCRITURAS.includes(n.expression.name.text)

/** `return X.error` as the statement, or as the first statement of a block. */
function devuelveElError(st: ts.Statement, variable: string): boolean {
  const ret = ts.isBlock(st) ? st.statements[0] : st
  return (
    !!ret &&
    ts.isReturnStatement(ret) &&
    !!ret.expression &&
    ts.isPropertyAccessExpression(ret.expression) &&
    ts.isIdentifier(ret.expression.expression) &&
    ret.expression.expression.text === variable &&
    ret.expression.name.text === "error"
  )
}

/** `if ("error" in X) return X.error` */
function esLaSalidaDelCargador(st: ts.Statement, variable: string): boolean {
  if (!ts.isIfStatement(st)) return false
  const c = st.expression
  return (
    ts.isBinaryExpression(c) &&
    c.operatorToken.kind === ts.SyntaxKind.InKeyword &&
    ts.isStringLiteral(c.left) &&
    c.left.text === "error" &&
    ts.isIdentifier(c.right) &&
    c.right.text === variable &&
    devuelveElError(st.thenStatement, variable)
  )
}

/** What is wrong with a handler that is supposed to load the order through the loader. */
function problemasDelCargador(m: Manejador, puedeLeerAntes: boolean): string[] {
  if (m.opaco) return [`cannot be checked: ${m.opaco}`]
  if (!m.nodo) return ["has no body to check"]
  const todos = nodos(m.nodo)
  const llamadas = todos.filter(esLlamadaAlCargador)
  if (llamadas.length === 0) return ["does not call cargarOrdenEnAlcance"]

  const llamada = llamadas[0]
  const problemas: string[] = []
  const espera = llamada.parent
  const declaracion = espera && ts.isAwaitExpression(espera) ? espera.parent : undefined
  if (!espera || !ts.isAwaitExpression(espera) || !declaracion || !ts.isVariableDeclaration(declaracion) || !ts.isIdentifier(declaracion.name)) {
    return ["calls cargarOrdenEnAlcance without awaiting it into a variable"]
  }

  const variable = declaracion.name.text
  const sentencia = declaracion.parent.parent as ts.Statement
  const hermanas = ts.isBlock(sentencia.parent) ? sentencia.parent.statements : undefined
  const siguiente = hermanas?.[hermanas.indexOf(sentencia) + 1]
  if (!siguiente || !esLaSalidaDelCargador(siguiente, variable)) {
    problemas.push(`does not return \`${variable}.error\` right after the call (if ("error" in ${variable}) return ${variable}.error)`)
  }

  const antes = todos.filter((n) => n.pos < llamada.pos)
  if (puedeLeerAntes) {
    if (antes.some(esEscritura)) problemas.push("writes before the loader")
  } else if (antes.some(tocaLaBase)) {
    problemas.push("touches the database before the loader")
  }
  return problemas
}

/** What is wrong with an exempt handler: the role check must come first, and answer 403. */
function problemasDeLaExencion(m: Manejador): string[] {
  if (m.opaco || !m.nodo) return [`cannot be checked: ${m.opaco ?? "no body"}`]
  const todos = nodos(m.nodo)
  if (todos.some(esLlamadaAlCargador)) return ["is exempt but calls the loader"]

  const guarda = todos.find(
    (n): n is ts.IfStatement =>
      ts.isIfStatement(n) &&
      nodos(n.expression).concat(n.expression).some(
        (e) =>
          ts.isBinaryExpression(e) &&
          e.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken &&
          ts.isIdentifier(e.left) &&
          e.left.text === "role" &&
          ts.isStringLiteral(e.right) &&
          e.right.text === "ADMIN",
      ),
  )
  if (!guarda) return ['has no `role !== "ADMIN"` check']
  const problemas: string[] = []
  if (!/\b403\b/.test(guarda.thenStatement.getText())) problemas.push("the role check does not answer 403")
  const primeraBase = todos.find(tocaLaBase)
  if (primeraBase && primeraBase.pos < guarda.pos) problemas.push("touches the database before the role check")
  return problemas
}

/** Everything a sweep over one route file reports, by `<route>#<METHOD>`. */
function evaluar(ruta: string, src: string): Array<{ clave: string; problemas: string[] }> {
  return manejadores(src).map((m) => {
    const clave = `${ruta}#${m.metodo}`
    const problemas = EXENTOS.has(clave) ? problemasDeLaExencion(m) : problemasDelCargador(m, LEE_ANTES_DEL_CARGADOR.has(clave))
    return { clave, problemas }
  })
}

describe("detector, with planted offenders", () => {
  const evalua = (src: string, clave = "[id]/x#GET") => {
    const [ruta] = clave.split("#")
    return evaluar(ruta, src)
  }
  const BIEN = `
    export async function GET() {
      const cargada = await cargarOrdenEnAlcance(id, actor, "ver")
      if ("error" in cargada) return cargada.error
      await supabaseAdmin.from("x").select("*")
    }`

  it("accepts a handler that loads the order, returns the refusal, and only then touches the database", () => {
    expect(evalua(BIEN)).toEqual([{ clave: "[id]/x#GET", problemas: [] }])
  })

  it.each([
    ["a function declaration", `export async function GET() { await supabaseAdmin.from("ordenes_servicio").select("id") }`],
    ["a non-async function", `export function GET() { return supabaseAdmin.from("ordenes_servicio").select("id") }`],
    ["a const arrow function", `export const GET = async () => { await supabaseAdmin.from("ordenes_servicio").select("id") }`],
    ["a const function expression", `export const GET = async function () { await supabaseAdmin.from("o").select("id") }`],
    ["a const wrapped in another call", `export const GET = conAuth(async () => { await supabaseAdmin.from("o").select("id") })`],
    ["a local function exported under its method name", `async function lista() { await supabaseAdmin.from("o").select("id") }\nexport { lista as GET }`],
  ])("flags %s that never loads the order", (_forma, src) => {
    const [r] = evalua(src)
    expect(r.problemas, src).toEqual(["does not call cargarOrdenEnAlcance"])
  })

  it("sees every export form of a handler that DOES load the order", () => {
    const cuerpo = `{ const c = await cargarOrdenEnAlcance(id, actor, "ver"); if ("error" in c) return c.error }`
    for (const src of [
      `export async function GET() ${cuerpo}`,
      `export const GET = async () => ${cuerpo}`,
      `async function lista() ${cuerpo}\nexport { lista as GET }`,
    ]) {
      expect(evalua(src), src).toEqual([{ clave: "[id]/x#GET", problemas: [] }])
    }
  })

  it.each([
    ["a re-export of a handler", `export { GET } from "./otra-ruta"`],
    ["an `export *`", `export * from "./otra-ruta"`],
    ["a handler exported by destructuring", `export const { GET } = handlers`],
    ["a name that is not defined here", `export { lista as GET }`],
  ])("flags %s: it cannot be checked", (_forma, src) => {
    const [r] = evalua(src)
    expect(r.problemas[0], src).toMatch(/^cannot be checked/)
  })

  it("covers HEAD and OPTIONS as well as the five usual methods", () => {
    const src = `export async function HEAD() {}\nexport async function OPTIONS() {}`
    expect(evalua(src).map((r) => r.clave)).toEqual(["[id]/x#HEAD", "[id]/x#OPTIONS"])
  })

  it("does not credit a handler with the call of a neighbour or of a helper below it", () => {
    const src = `
      export async function GET() { await supabaseAdmin.from("o").select("id") }
      async function auxiliar() { const c = await cargarOrdenEnAlcance(id, actor, "ver"); if ("error" in c) return c.error }
      export async function POST() { const c = await cargarOrdenEnAlcance(id, actor, "ver"); if ("error" in c) return c.error }`
    expect(evaluar("[id]/x", src).map((r) => [r.clave, r.problemas.length])).toEqual([
      ["[id]/x#GET", 1],
      ["[id]/x#POST", 0],
    ])
  })

  it("keeps a handler's body whole when it holds braces and quotes in strings and templates", () => {
    const src = `
      export async function GET() {
        const mensaje = "falta } y { en el texto"
        const otro = \`\${"}"} {\`
        const cargada = await cargarOrdenEnAlcance(id, actor, "ver")
        if ("error" in cargada) return cargada.error
      }
      export async function POST() { await supabaseAdmin.from("o").select("id") }`
    expect(evaluar("[id]/x", src).map((r) => [r.clave, r.problemas.length])).toEqual([
      ["[id]/x#GET", 0],
      ["[id]/x#POST", 1],
    ])
  })

  it("is not fooled by the call in a comment or in a string", () => {
    const src = `
      export async function GET() {
        // const c = await cargarOrdenEnAlcance(id, actor, "ver")
        /* if ("error" in c) return c.error */
        const texto = "cargarOrdenEnAlcance(id)"
        await supabaseAdmin.from("o").select("id")
      }`
    expect(evalua(src)[0].problemas).toEqual(["does not call cargarOrdenEnAlcance"])
  })

  it("flags a loader call that is not awaited into a variable", () => {
    expect(evalua(`export async function GET() { cargarOrdenEnAlcance(id, actor, "ver") }`)[0].problemas).toEqual([
      "calls cargarOrdenEnAlcance without awaiting it into a variable",
    ])
    expect(evalua(`export async function GET() { const c = cargarOrdenEnAlcance(id, actor, "ver"); if ("error" in c) return c.error }`)[0].problemas).toEqual([
      "calls cargarOrdenEnAlcance without awaiting it into a variable",
    ])
  })

  it.each([
    ["nothing after the call", `const c = await cargarOrdenEnAlcance(id, actor, "ver")\n void c`],
    ["a check that does not return", `const c = await cargarOrdenEnAlcance(id, actor, "ver")\n if ("error" in c) console.log("x")`],
    ["a check that returns something else", `const c = await cargarOrdenEnAlcance(id, actor, "ver")\n if ("error" in c) return null`],
    ["a check on another variable", `const c = await cargarOrdenEnAlcance(id, actor, "ver")\n if ("error" in otra) return otra.error`],
    ["a statement in between", `const c = await cargarOrdenEnAlcance(id, actor, "ver")\n await supabaseAdmin.from("o").select("id")\n if ("error" in c) return c.error`],
  ])("flags %s: the refusal is not returned right after the call", (_caso, cuerpo) => {
    const [r] = evalua(`export async function GET() {\n${cuerpo}\n}`)
    expect(r.problemas[0], cuerpo).toMatch(/does not return `c\.error` right after the call/)
  })

  it("accepts the refusal returned from inside a block", () => {
    const src = `export async function GET() { const c = await cargarOrdenEnAlcance(id, actor, "ver"); if ("error" in c) { return c.error } }`
    expect(evalua(src)[0].problemas).toEqual([])
  })

  it("flags a handler that reads or writes before the loader", () => {
    const lee = `export async function GET() {
      const { data } = await supabaseAdmin.from("o").select("id")
      const c = await cargarOrdenEnAlcance(id, actor, "ver"); if ("error" in c) return c.error }`
    const rpc = `export async function POST() {
      await otro.rpc("hacer", {})
      const c = await cargarOrdenEnAlcance(id, actor, "ver"); if ("error" in c) return c.error }`
    expect(evalua(lee)[0].problemas).toEqual(["touches the database before the loader"])
    expect(evalua(rpc, "[id]/x#POST")[0].problemas).toEqual(["touches the database before the loader"])
  })

  it("lets a listed handler read before the loader, and never write", () => {
    const lee = `export async function DELETE() {
      const { data } = await supabaseAdmin.from("fotos_orden").select("id").single()
      const c = await cargarOrdenEnAlcance(data.orden_id, actor, "reparar"); if ("error" in c) return c.error }`
    const escribe = `export async function DELETE() {
      await supabaseAdmin.from("fotos_orden").delete().eq("id", fotoId)
      const c = await cargarOrdenEnAlcance(id, actor, "reparar"); if ("error" in c) return c.error }`
    expect(evaluar("[id]/fotos", lee)[0].problemas).toEqual([])
    expect(evaluar("[id]/fotos", escribe)[0].problemas).toEqual(["writes before the loader"])
  })

  describe("exemptions", () => {
    const exento = (cuerpo: string) => evaluar("[id]/cobros", `export async function DELETE() {\n${cuerpo}\n}`)[0].problemas

    it("accepts the role check first, answering 403", () => {
      expect(exento(`if (role !== "ADMIN") { return NextResponse.json({ error: "x" }, { status: 403 }) }\n await supabaseAdmin.from("c").delete()`)).toEqual([])
    })

    it("flags a handler with no role check", () => {
      expect(exento(`await supabaseAdmin.from("c").delete()`)).toEqual(['has no `role !== "ADMIN"` check'])
    })

    it("flags a role check that comes after the database", () => {
      expect(
        exento(`await supabaseAdmin.from("c").select("id")\n if (role !== "ADMIN") { return NextResponse.json({}, { status: 403 }) }`),
      ).toEqual(["touches the database before the role check"])
    })

    it("flags a role check that does not answer 403", () => {
      expect(exento(`if (role !== "ADMIN") { return NextResponse.json({}, { status: 401 }) }`)).toEqual(["the role check does not answer 403"])
    })

    it("flags an exempt handler that calls the loader (the exemption is stale)", () => {
      expect(exento(`const c = await cargarOrdenEnAlcance(id, actor, "ver"); if ("error" in c) return c.error`)).toEqual([
        "is exempt but calls the loader",
      ])
    })
  })
})

describe("source tree", () => {
  const archivos = leerFuentes(["app/api/ordenes"]).filter((a) => RUTA.test(a.rel))
  const rutaDe = (rel: string) => RUTA.exec(rel)![1]
  const evaluados = archivos.flatMap((a) => evaluar(rutaDe(a.rel), a.src))

  it("finds exactly the handlers the sweep knows about", () => {
    expect(evaluados.map((e) => e.clave).sort()).toEqual([...MANEJADORES_ESPERADOS].sort())
  })

  it("every handler reads the order through cargarOrdenEnAlcance, or is exempt with a reason", () => {
    const mal = evaluados.filter((e) => e.problemas.length > 0).map((e) => `${e.clave}: ${e.problemas.join("; ")}`)

    expect(mal).toEqual([])
  })

  it("every exemption and every early read names a handler that exists, with a reason", () => {
    const existentes = new Set(evaluados.map((e) => e.clave))

    for (const [clave, motivo] of [...EXENTOS, ...LEE_ANTES_DEL_CARGADOR]) {
      expect(existentes.has(clave), `${clave} does not exist`).toBe(true)
      expect(motivo.length, clave).toBeGreaterThan(20)
    }
  })
})
