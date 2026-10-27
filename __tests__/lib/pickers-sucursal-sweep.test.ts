import { describe, it, expect } from "vitest"
import { leerFuentes, sinComentarios } from "../helpers/fuentes"

// BM-4: the technician and seller lists answer for one branch (`?sucursalId=`). A
// screen that has an order in front of it must ask for the branch that handles it;
// the server's default (no param) is the request's effective branch, which is right
// for a list with no order behind it.
//
// This sweep enumerates every client call to the two LIST endpoints and fails on a
// new one that neither passes `sucursalId` nor sits in EXENTOS with the reason the
// default is the right answer for it. (Calls to /api/tecnicos/<id> and
// /api/vendedores/<id> are not lists.)
const RAICES = ["app", "components"]

// Files whose list has no order behind it, so the effective branch the server
// applies when the param is absent (the ADMIN's selected branch or all of them, or the
// user's own branch) is the right scope. Passing a branch from the client would only
// copy a value the server already holds, and the localStorage mirror of the switcher
// can disagree with the httpOnly cookie that actually decides.
const EXENTOS = new Map<string, string>([
  ["components/agenda/agenda-view.tsx", "filter of the agenda: no order behind it, the ADMIN's selected branch applies"],
  ["components/comisiones/comisiones-view.tsx", "technician filter of the commissions screen: no order behind it, effective branch"],
  ["components/comisiones/comisiones-vendedores-view.tsx", "seller list of the commissions screen: no order behind it, effective branch"],
  ["components/emails/email-compose.tsx", "recipients picker: no order behind it, the effective branch applies"],
  ["components/ordenes/ordenes-list.tsx", "technician filter of the orders list: no single order, the effective branch applies"],
  [
    "components/tecnicos/reasignar-ordenes-dialog.tsx",
    "moves every open order of one technician, which can span branches; the reasignar route is scoped " +
      "later and decides the destination rule, so the picker keeps the effective branch until then",
  ],
  ["components/tecnicos/tecnicos-list.tsx", "management list of technicians: effective branch (the Sucursal column is a later PR)"],
  ["components/tecnicos/tecnicos-ranking.tsx", "ranking of technicians: no order behind it, the effective branch applies"],
  ["components/tecnicos/tecnico-form.tsx", "the create/edit form POSTs or PUTs a technician, it does not read the list"],
  ["components/vendedores/vendedores-list.tsx", "management list of sellers: no order behind it, the effective branch applies"],
  ["components/vendedores/vendedor-form.tsx", "the create/edit form POSTs or PUTs a seller, it does not read the list"],
])

// `/api/tecnicos` or `/api/vendedores` followed by the end of the string or a query
// string, i.e. the collection and not a `/api/tecnicos/<id>` resource.
const LISTA = /\/api\/(?:tecnicos|vendedores)(?=["'`?])/g

interface Consumo {
  endpoint: string
  conSucursal: boolean
}

function consumos(fuente: string): Consumo[] {
  const src = sinComentarios(fuente)
  return [...src.matchAll(LISTA)].map((m) => {
    // The string literal the endpoint sits in runs to its closing quote.
    const literal = src.slice(m.index! + m[0].length).split(/["'`]/, 1)[0]
    // Scoped: the query names the branch, or says it is for creating something
    // (`alcance=escritura`: the branch the write will land in).
    return { endpoint: m[0], conSucursal: /^\?(?:[^&]*&)*(?:sucursalId=|alcance=escritura(?:&|$))/.test(literal) }
  })
}

const sinSucursal = (fuente: string) => consumos(fuente).some((c) => !c.conSucursal)

describe("detector", () => {
  it.each([
    ["a bare literal", `fetch("/api/tecnicos")`],
    ["a bare template", "fetch(`/api/vendedores`)"],
    ["useSWR with a bare key", `useSWR(open ? "/api/tecnicos" : null, fetcher)`],
    ["a query that is not the branch", `fetch("/api/vendedores?limit=100")`],
    ["a query built elsewhere", "return `/api/vendedores?${params.toString()}`"],
    ["a query with sucursalId only in a later argument", `fetch("/api/tecnicos?dias=7", { headers: { sucursalId: x } })`],
    ["one scoped and one bare call in the same file", `fetch("/api/tecnicos?sucursalId=a")\nfetch("/api/tecnicos")`],
  ])("flags %s", (_caso, src) => {
    expect(sinSucursal(src)).toBe(true)
  })

  it.each([
    ["a scoped template", "fetch(`/api/tecnicos?sucursalId=${encodeURIComponent(id)}`)"],
    ["the branch after another param", "fetch(`/api/vendedores?limit=100&sucursalId=${id}`)"],
    ["the write scope", "fetch(`/api/tecnicos?alcance=escritura`)"],
    ["a resource, not the list", "fetch(`/api/tecnicos/${id}/ordenes`)"],
    ["the summary endpoint", "fetch(`/api/tecnicos/summary?dias=7`)"],
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
})

describe("source tree", () => {
  const archivos = leerFuentes(RAICES).filter((a) => !a.rel.startsWith("app/api/"))

  it("scans the real tree and finds the consumers (guards against a ghost loop)", () => {
    const rels = new Set(archivos.map((a) => a.rel))
    expect(archivos.length).toBeGreaterThan(300)
    for (const esperado of [
      "components/ordenes/orden-detail.tsx",
      "components/ordenes/orden-form.tsx",
      "components/tecnicos/tecnicos-list.tsx",
      "components/vendedores/vendedores-list.tsx",
      "components/emails/email-compose.tsx",
    ]) {
      expect(rels.has(esperado), esperado).toBe(true)
      expect(consumos(archivos.find((a) => a.rel === esperado)!.src).length, esperado).toBeGreaterThan(0)
    }
  })

  it("an order's own screen asks for the branch that handles the order", () => {
    const detalle = archivos.find((a) => a.rel === "components/ordenes/orden-detail.tsx")!
    const lista = consumos(detalle.src)
    expect(lista.length).toBeGreaterThan(0)
    expect(lista.every((c) => c.conSucursal)).toBe(true)
  })

  it("every exemption is still a file that fetches a list without the branch", () => {
    const porRuta = new Map(archivos.map((a) => [a.rel, a.src]))
    const obsoletos = [...EXENTOS.keys()].filter((rel) => !porRuta.has(rel) || !sinSucursal(porRuta.get(rel)!))
    expect(obsoletos).toEqual([])
  })

  it("every exemption says why", () => {
    for (const [rel, razon] of EXENTOS) expect(razon.length, rel).toBeGreaterThan(30)
  })

  it("no list is fetched without the branch outside the exemptions", () => {
    const ofensores = archivos
      .filter(({ rel, src }) => sinSucursal(src) && !EXENTOS.has(rel))
      .map(({ rel }) => rel)
      .sort()
    expect(ofensores).toEqual([])
  })
})
