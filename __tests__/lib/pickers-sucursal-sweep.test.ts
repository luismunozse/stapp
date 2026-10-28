import { describe, it, expect } from "vitest"
import { leerFuentes, sinComentarios } from "../helpers/fuentes"

// BM-4: the technician and seller lists answer for one branch. A screen that has an order in
// front of it asks for the branch that handles it (`?sucursalId=`); a screen that CREATES
// something asks for the branch the write will land in (`?alcance=escritura`, the branch the
// server validates the assignment against); a plain list with no order behind it relies on the
// server's default, the request's effective branch.
//
// This sweep enumerates every client call to the two LIST endpoints and fails on a new one that
// declares neither scope and is not in EXENTOS. Exemptions are per CALL: each file records how
// many bare calls it was reviewed for, so a second bare call in an exempt file fails too.
// (Calls to /api/tecnicos/<id> and /api/vendedores/<id> are not lists.)
const RAICES = ["app", "components", "hooks", "lib", "contexts"]

interface Exencion {
  /** How many bare calls to the list endpoints the file had when it was reviewed. */
  llamadas: number
  razon: string
}

// Files whose list has no order behind it, so the effective branch the server applies when the
// param is absent (the ADMIN's selected branch or all of them, or the user's own branch) is the
// right scope. Passing a branch from the client would only copy a value the server already
// holds, and the localStorage mirror of the switcher can disagree with the httpOnly cookie that
// actually decides.
const EXENTOS = new Map<string, Exencion>([
  ["components/agenda/agenda-view.tsx", { llamadas: 1, razon: "filter of the agenda: no order behind it, the ADMIN's selected branch applies" }],
  ["components/comisiones/comisiones-view.tsx", { llamadas: 1, razon: "technician filter of the commissions screen: no order behind it" }],
  ["components/comisiones/comisiones-vendedores-view.tsx", { llamadas: 1, razon: "seller list of the commissions screen: no order behind it" }],
  ["components/emails/email-compose.tsx", { llamadas: 2, razon: "recipients picker (technicians and sellers): no order behind it" }],
  ["components/ordenes/ordenes-list.tsx", { llamadas: 1, razon: "technician filter of the orders list: no single order behind it" }],
  [
    "components/tecnicos/reasignar-ordenes-dialog.tsx",
    {
      llamadas: 1,
      razon:
        "moves every open order of one technician, which can span branches; the reasignar route is scoped " +
        "later and decides the destination rule, so the picker keeps the effective branch until then",
    },
  ],
  ["components/tecnicos/tecnicos-list.tsx", { llamadas: 1, razon: "management list of technicians (the Sucursal column is a later PR)" }],
  ["components/tecnicos/tecnicos-ranking.tsx", { llamadas: 1, razon: "ranking of technicians: no order behind it" }],
  ["components/tecnicos/tecnico-form.tsx", { llamadas: 1, razon: "the create/edit form POSTs or PUTs a technician, it does not read the list" }],
  ["components/vendedores/vendedores-list.tsx", { llamadas: 1, razon: "management list of sellers: no order behind it" }],
  ["components/vendedores/vendedor-form.tsx", { llamadas: 1, razon: "the create/edit form POSTs or PUTs a seller, it does not read the list" }],
])

// `/api/tecnicos` or `/api/vendedores` NOT continued as another path segment or another endpoint
// name: the collection (followed by a quote, a `?`, a `${..}`, a `+`, a trailing slash...) and not
// `/api/tecnicos/<id>`, `/api/tecnicos/summary`, `/api/tecnicos/[id]` or `/api/tecnicos-x`.
const LISTA = /\/api\/(?:tecnicos|vendedores)(?![\w-]|\/[\w$[])/g

// A call is scoped when its query names the branch (`sucursalId=`) or says it is for creating
// something (`alcance=escritura`).
const ALCANCE_DECLARADO = /^\/?\?(?:[^&]*&)*(?:sucursalId=|alcance=escritura(?:&|$))/

interface Consumo {
  endpoint: string
  conSucursal: boolean
}

function consumos(fuente: string): Consumo[] {
  const src = sinComentarios(fuente)
  return [...src.matchAll(LISTA)].map((m) => {
    // The string literal the endpoint sits in runs to its closing quote.
    const literal = src.slice(m.index! + m[0].length).split(/["'`]/, 1)[0]
    return { endpoint: m[0], conSucursal: ALCANCE_DECLARADO.test(literal) }
  })
}

const llamadasSinSucursal = (fuente: string) => consumos(fuente).filter((c) => !c.conSucursal).length
const sinSucursal = (fuente: string) => llamadasSinSucursal(fuente) > 0

describe("detector", () => {
  it.each([
    ["a bare literal", `fetch("/api/tecnicos")`],
    ["a bare template", "fetch(`/api/vendedores`)"],
    ["useSWR with a bare key", `useSWR(open ? "/api/tecnicos" : null, fetcher)`],
    ["a query that is not the branch", `fetch("/api/vendedores?limit=100")`],
    ["a query built elsewhere", "return `/api/vendedores?${params.toString()}`"],
    ["a query with sucursalId only in a later argument", `fetch("/api/tecnicos?dias=7", { headers: { sucursalId: x } })`],
    ["one scoped and one bare call in the same file", `fetch("/api/tecnicos?sucursalId=a")\nfetch("/api/tecnicos")`],
    ["a scope that is not the write one", `fetch("/api/tecnicos?alcance=lectura")`],
    ["a write scope that only starts like it", `fetch("/api/tecnicos?alcance=escrituraX")`],
    // Blind spots of the first version: the endpoint followed by anything but a quote or a `?`.
    ["a query string spliced in a template", "fetch(`/api/tecnicos${qs}`)"],
    ["a trailing slash", `fetch("/api/tecnicos/")`],
    ["a trailing slash and a query without the branch", "fetch(`/api/vendedores/?limit=5`)"],
    ["a concatenated query", `fetch("/api/tecnicos" + qs)`],
    ["a concatenation whose literal part is not the branch", `fetch("/api/tecnicos?dias=7&" + qs)`],
  ])("flags %s", (_caso, src) => {
    expect(sinSucursal(src)).toBe(true)
  })

  it.each([
    ["a scoped template", "fetch(`/api/tecnicos?sucursalId=${encodeURIComponent(id)}`)"],
    ["the branch after another param", "fetch(`/api/vendedores?limit=100&sucursalId=${id}`)"],
    ["the write scope", "fetch(`/api/tecnicos?alcance=escritura`)"],
    ["the write scope after another param", "fetch(`/api/tecnicos?dias=7&alcance=escritura`)"],
    ["a scoped call with a trailing slash", "fetch(`/api/tecnicos/?sucursalId=${id}`)"],
    ["a resource, not the list", "fetch(`/api/tecnicos/${id}/ordenes`)"],
    ["a resource by a literal id", `fetch("/api/vendedores/abc123")`],
    ["a resource written as a route pattern", "const ruta = '/api/tecnicos/[id]/estado'"],
    ["the summary endpoint", "fetch(`/api/tecnicos/summary?dias=7`)"],
    ["another endpoint that starts with the same word", `fetch("/api/tecnicos-externos")`],
    ["no call at all", `const x = "/api/operadores?rol=VENDEDOR"`],
    ["the endpoint named only in a comment", `// GET /api/tecnicos\nconst y = 1`],
  ])("ignores %s", (_caso, src) => {
    expect(sinSucursal(src)).toBe(false)
  })

  it("sees a scoped call as a call (not a ghost)", () => {
    expect(consumos("fetch(`/api/tecnicos?sucursalId=${id}`)")).toEqual([
      { endpoint: "/api/tecnicos", conSucursal: true },
    ])
  })

  // Exemptions are per CALL: a second bare call in an exempt file is a new consumer.
  it("counts the bare calls of a file, one by one", () => {
    expect(llamadasSinSucursal(`fetch("/api/tecnicos")\nfetch("/api/vendedores")`)).toBe(2)
    expect(llamadasSinSucursal(`fetch("/api/tecnicos?sucursalId=a")\nfetch("/api/tecnicos")`)).toBe(1)
    expect(llamadasSinSucursal(`fetch("/api/tecnicos?sucursalId=a")`)).toBe(0)
    expect(llamadasSinSucursal("const a = 1")).toBe(0)
  })
})

describe("source tree", () => {
  const archivos = leerFuentes(RAICES).filter((a) => !a.rel.startsWith("app/api/"))
  const porRuta = new Map(archivos.map((a) => [a.rel, a.src]))

  it("scans every root a client call can live in (guards against a ghost loop)", () => {
    expect([...new Set(archivos.map((a) => a.rel.split("/")[0]))].sort()).toEqual([
      "app",
      "components",
      "contexts",
      "hooks",
      "lib",
    ])
    expect(archivos.length).toBeGreaterThan(500)
    for (const esperado of [
      "components/ordenes/orden-detail.tsx",
      "components/ordenes/orden-form.tsx",
      "components/agenda/turno-form-dialog.tsx",
      "components/tecnicos/tecnicos-list.tsx",
      "components/vendedores/vendedores-list.tsx",
      "components/emails/email-compose.tsx",
    ]) {
      expect(porRuta.has(esperado), esperado).toBe(true)
      expect(consumos(porRuta.get(esperado)!).length, esperado).toBeGreaterThan(0)
    }
  })

  it("the screens that act on an order declare their scope", () => {
    const detalle = consumos(porRuta.get("components/ordenes/orden-detail.tsx")!)
    expect(detalle.length).toBeGreaterThan(0)
    expect(detalle.every((c) => c.conSucursal)).toBe(true)
    for (const creacion of ["components/ordenes/orden-form.tsx", "components/agenda/turno-form-dialog.tsx"]) {
      const lista = consumos(porRuta.get(creacion)!)
      expect(lista.length, creacion).toBeGreaterThan(0)
      expect(lista.every((c) => c.conSucursal), creacion).toBe(true)
    }
  })

  it("every exemption still has exactly the bare calls it was reviewed for", () => {
    const desajustes = [...EXENTOS]
      .filter(([rel, e]) => llamadasSinSucursal(porRuta.get(rel) ?? "") !== e.llamadas)
      .map(([rel, e]) => `${rel}: reviewed for ${e.llamadas}, found ${llamadasSinSucursal(porRuta.get(rel) ?? "")}`)
    expect(desajustes).toEqual([])
  })

  it("every exemption states a reason", () => {
    expect([...EXENTOS].filter(([, e]) => e.razon.trim() === "").map(([rel]) => rel)).toEqual([])
  })

  it("no list is fetched without declaring its scope outside the exemptions", () => {
    const ofensores = archivos
      .filter(({ rel, src }) => sinSucursal(src) && !EXENTOS.has(rel))
      .map(({ rel }) => rel)
      .sort()
    expect(ofensores).toEqual([])
  })
})
