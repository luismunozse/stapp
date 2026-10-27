// @vitest-environment node
/**
 * Loading an order within the actor's scope (change sucursales-aislamiento, PR3; XC-1, XC-2,
 * OI-2, OI-3, BM-6).
 *
 * `cargarOrdenEnAlcance(id, actor, accion)` is the one door the order routes use to read an order:
 *  - an order outside the scope answers EXACTLY what a nonexistent id answers (same status, same
 *    body), before anything else happens;
 *  - an action the actor may not take on an order he can see is a 403;
 *  - either refusal writes, notifies and looks up nothing else.
 *
 * The orders table is in-memory and honours its filters (and refuses a column no fixture row has),
 * so the loader that selects, or filters on, a column that does not exist fails here as it would
 * in the database.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { montarSupabaseEnMemoria } from "../helpers/supabase-memoria"
import { cargarOrdenEnAlcance, actorDeSesion } from "@/lib/ordenes/alcance"

const A = "suc-A"
const B = "suc-B"

const orden = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  organization_id: "org-1",
  sucursal_id: A,
  tecnico_id: null,
  estado: "RECIBIDO",
  numero_orden: 7,
  clientes: { id: "c-1", nombre: "Juan" },
  ...extra,
})

const ORDENES = [
  orden("o-a-libre"),
  orden("o-a-t1", { tecnico_id: "t-1" }),
  orden("o-a-t2", { tecnico_id: "t-2" }),
  orden("o-b-libre", { sucursal_id: B }),
  orden("o-b-t1", { sucursal_id: B, tecnico_id: "t-1" }),
  orden("o-b-t2", { sucursal_id: B, tecnico_id: "t-2" }),
  orden("o-otra-org", { organization_id: "org-2" }),
]

const actor = (role: string, sucursalId: string | null, userId = "u-1") => ({
  organizationId: "org-1",
  userId,
  role,
  sucursalId,
})
const admin = actor("ADMIN", null, "adm")
const vendedorA = actor("VENDEDOR", A, "v-a")
const tecnicoA = actor("TECNICO", A, "t-1")
const tecnicoSinSucursal = actor("TECNICO", null, "t-1")

let mem: ReturnType<typeof montarSupabaseEnMemoria>

function montar(opciones: { toma?: boolean | "sin-columna" } = {}) {
  const org: Record<string, unknown> = { id: "org-1" }
  if (opciones.toma !== "sin-columna") org.tecnicos_toman_ordenes = opciones.toma ?? false
  mem = montarSupabaseEnMemoria({ ordenes_servicio: ORDENES, organizations: [org, { id: "org-2", tecnicos_toman_ordenes: true }] })
}

/** What the caller would send back for a refusal. */
async function respuestaDe(resultado: Awaited<ReturnType<typeof cargarOrdenEnAlcance>>) {
  if (!("error" in resultado)) throw new Error("expected a refusal, got the order")
  return { status: resultado.error.status, body: await resultado.error.json() }
}

const NO_ENCONTRADA = { status: 404, body: { error: "Orden no encontrada" } }
const NO_AUTORIZADO = { status: 403, body: { error: "No autorizado" } }

describe("cargarOrdenEnAlcance - not found is one answer (XC-2)", () => {
  beforeEach(() => montar({ toma: true }))

  it("a nonexistent id is 404 'Orden no encontrada'", async () => {
    expect(await respuestaDe(await cargarOrdenEnAlcance("no-existe", vendedorA, "ver"))).toEqual(NO_ENCONTRADA)
  })

  it.each([
    ["a VENDEDOR of A, order of B", vendedorA, "o-b-libre"],
    ["a TECNICO of A, an unassigned order of B (toma ON)", tecnicoA, "o-b-libre"],
    ["a TECNICO of A, another technician's order of B", tecnicoA, "o-b-t2"],
    ["a branchless TECNICO, an unassigned order (toma ON)", tecnicoSinSucursal, "o-a-libre"],
    ["a VENDEDOR with no branch", actor("VENDEDOR", null, "v-0"), "o-a-libre"],
    ["a VENDEDOR of A that still holds an order of B (his role changed)", actor("VENDEDOR", A, "t-1"), "o-b-t1"],
    ["anyone, an order of another organization", vendedorA, "o-otra-org"],
    ["an ADMIN, an order of another organization", admin, "o-otra-org"],
  ])("%s gets exactly what a nonexistent id gets", async (_quien, quien, id) => {
    const inexistente = await respuestaDe(await cargarOrdenEnAlcance("no-existe", quien, "reparar"))

    for (const accion of ["ver", "leer", "editar", "reparar", "comercial", "entregar"] as const) {
      const fuera = await respuestaDe(await cargarOrdenEnAlcance(id, quien, accion))
      expect(fuera, accion).toEqual(inexistente)
      expect(fuera, accion).toEqual(NO_ENCONTRADA)
    }
  })

  it("refusing writes, notifies and looks up nothing: only the order is read, no flag, no write", async () => {
    await cargarOrdenEnAlcance("o-b-libre", vendedorA, "editar")
    await cargarOrdenEnAlcance("o-b-libre", tecnicoA, "editar")
    await cargarOrdenEnAlcance("no-existe", tecnicoA, "editar")

    expect(mem.escrituras).toEqual([])
    expect(mem.lecturas).toEqual(["ordenes_servicio", "ordenes_servicio", "ordenes_servicio"])
  })

  it("the message can be the route's own, for the missing order and the out-of-scope one alike", async () => {
    const opciones = { noEncontrada: "Orden original no encontrada" }

    const inexistente = await respuestaDe(await cargarOrdenEnAlcance("no-existe", vendedorA, "ver", opciones))
    const fuera = await respuestaDe(await cargarOrdenEnAlcance("o-b-libre", vendedorA, "ver", opciones))

    expect(inexistente).toEqual({ status: 404, body: { error: "Orden original no encontrada" } })
    expect(fuera).toEqual(inexistente)
  })
})

describe("cargarOrdenEnAlcance - scope", () => {
  beforeEach(() => montar({ toma: true }))

  it.each([
    ["an ADMIN, an order of any branch", admin, "o-b-libre"],
    ["an ADMIN, another technician's order", admin, "o-a-t2"],
    ["a VENDEDOR of A, an unassigned order of A", vendedorA, "o-a-libre"],
    ["a VENDEDOR of A, an order of A assigned to a technician", vendedorA, "o-a-t2"],
    ["a TECNICO of A, his own order", tecnicoA, "o-a-t1"],
    ["a TECNICO of A, his own order of B (BM-6: assigned-to-me crosses branches)", tecnicoA, "o-b-t1"],
    ["a branchless TECNICO, his own order (XC-4)", tecnicoSinSucursal, "o-a-t1"],
  ])("%s is loaded", async (_quien, quien, id) => {
    const resultado = await cargarOrdenEnAlcance(id, quien, "ver")

    if ("error" in resultado) throw new Error(`refused: ${resultado.error.status}`)
    expect(resultado.orden.id).toBe(id)
    expect(resultado.permisos.ver).toBe(true)
  })

  it("returns the order with the columns the route asked for and the ones the policy needs", async () => {
    const resultado = await cargarOrdenEnAlcance("o-a-t1", tecnicoA, "ver", { select: "id, clientes(*)" })

    if ("error" in resultado) throw new Error("refused")
    expect(resultado.orden).toMatchObject({
      id: "o-a-t1",
      clientes: { id: "c-1", nombre: "Juan" },
      sucursal_id: A,
      tecnico_id: "t-1",
    })
    // The route did not ask for these.
    expect(resultado.orden).not.toHaveProperty("estado")
    expect(resultado.orden).not.toHaveProperty("numero_orden")
  })

  it.each([
    ["every column", "*, clientes(*)"],
    ["every column, spread over lines", "\n  *,\n  clientes (*)\n"],
    ["every column, after an embed", "clientes(nombre), *"],
  ])("a select with %s is left as the route wrote it", async (_nombre, select) => {
    await cargarOrdenEnAlcance("o-a-t1", tecnicoA, "ver", { select })

    expect(mem.consultas("ordenes_servicio")).toEqual([select])
  })

  it.each([
    ["an embed of every column", "id, clientes(*)"],
    ["a star between the columns of an embed", "id, clientes(nombre, *, telefono)"],
  ])("%s is not every column of the order: the scope columns are added", async (_nombre, select) => {
    await cargarOrdenEnAlcance("o-a-t1", tecnicoA, "ver", { select })

    expect(mem.consultas("ordenes_servicio")).toEqual([`${select}, sucursal_id, tecnico_id`])
  })

  it("never selects or filters on the derivation column (it does not exist until the migration)", async () => {
    await cargarOrdenEnAlcance("o-a-t1", tecnicoA, "ver")
    await cargarOrdenEnAlcance("o-a-t1", tecnicoA, "ver", { select: "id" })

    expect(mem.consultas("ordenes_servicio").join(" ")).not.toContain("derivada_a_sucursal_id")
  })

  it("asks for the order by id inside the organization", async () => {
    // The fixture has the same id in two organizations: only the actor's is reachable.
    mem = montarSupabaseEnMemoria({
      ordenes_servicio: [orden("o-dup", { numero_orden: 1 }), orden("o-dup", { organization_id: "org-2", numero_orden: 2 })],
      organizations: [{ id: "org-1", tecnicos_toman_ordenes: false }],
    })

    const resultado = await cargarOrdenEnAlcance("o-dup", admin, "ver")

    if ("error" in resultado) throw new Error("refused")
    expect(resultado.orden.numero_orden).toBe(1)
  })
})

describe("cargarOrdenEnAlcance - a denied action on a visible order is 403", () => {
  beforeEach(() => montar({ toma: false }))

  it.each([
    ["editar", "o-a-t2"],
    ["leer", "o-a-t2"],
    ["editar", "o-a-libre"],
    ["leer", "o-a-libre"],
  ] as const)("a TECNICO of A, %s on %s (not his, toma OFF)", async (accion, id) => {
    expect(await respuestaDe(await cargarOrdenEnAlcance(id, tecnicoA, accion))).toEqual(NO_AUTORIZADO)
  })

  it("the same order is available for the actions that are not narrowed to the technician", async () => {
    for (const accion of ["ver", "reparar", "comercial", "entregar"] as const) {
      const resultado = await cargarOrdenEnAlcance("o-a-t2", tecnicoA, accion)
      expect("error" in resultado, accion).toBe(false)
    }
  })

  it("only a derived order can be returned; the origin may derive one that is not", async () => {
    expect(await respuestaDe(await cargarOrdenEnAlcance("o-a-libre", vendedorA, "devolver"))).toEqual(NO_AUTORIZADO)
    expect(await respuestaDe(await cargarOrdenEnAlcance("o-a-libre", admin, "devolver"))).toEqual(NO_AUTORIZADO)
    expect("error" in (await cargarOrdenEnAlcance("o-a-libre", vendedorA, "derivar"))).toBe(false)
  })

  it("a refusal writes nothing and notifies nothing", async () => {
    await cargarOrdenEnAlcance("o-a-t2", tecnicoA, "editar")

    expect(mem.escrituras).toEqual([])
  })
})

describe("cargarOrdenEnAlcance - the technician's narrowing (OI-3, BM-6)", () => {
  it("toma ON: opens and claims an unassigned order of his own branch, edits nothing", async () => {
    montar({ toma: true })

    const abre = await cargarOrdenEnAlcance("o-a-libre", tecnicoA, "leer")
    if ("error" in abre) throw new Error("refused")
    expect(abre.permisos.tomar).toBe(true)

    expect(await respuestaDe(await cargarOrdenEnAlcance("o-a-libre", tecnicoA, "editar"))).toEqual(NO_AUTORIZADO)
  })

  it("toma ON: an unassigned order of another branch is not found, not 'forbidden'", async () => {
    montar({ toma: true })

    expect(await respuestaDe(await cargarOrdenEnAlcance("o-b-libre", tecnicoA, "leer"))).toEqual(NO_ENCONTRADA)
  })

  it("toma OFF and toma unreadable behave the same: the unassigned order is closed to him", async () => {
    for (const toma of [false, "sin-columna"] as const) {
      montar({ toma })
      expect(await respuestaDe(await cargarOrdenEnAlcance("o-a-libre", tecnicoA, "leer")), String(toma)).toEqual(NO_AUTORIZADO)
    }
  })

  it("the flag is read only when it can change the answer", async () => {
    montar({ toma: true })

    await cargarOrdenEnAlcance("o-a-libre", admin, "leer")
    await cargarOrdenEnAlcance("o-a-libre", vendedorA, "leer")
    await cargarOrdenEnAlcance("o-a-t1", tecnicoA, "leer") // his own
    await cargarOrdenEnAlcance("o-a-t2", tecnicoA, "leer") // a colleague's
    await cargarOrdenEnAlcance("o-b-libre", tecnicoA, "leer") // another branch
    expect(mem.lecturas.filter((t) => t === "organizations")).toEqual([])

    await cargarOrdenEnAlcance("o-a-libre", tecnicoA, "leer") // unassigned, his branch
    expect(mem.lecturas.filter((t) => t === "organizations")).toEqual(["organizations"])
  })

  it("a flag the caller already read is not read again", async () => {
    montar({ toma: true })

    const resultado = await cargarOrdenEnAlcance("o-a-libre", tecnicoA, "leer", { tomaSinAsignar: true })

    if ("error" in resultado) throw new Error("refused")
    expect(resultado.permisos.tomar).toBe(true)
    expect(mem.lecturas).not.toContain("organizations")
  })

  it("a flag the caller read as off is honoured: the unassigned order stays closed", async () => {
    montar({ toma: true })

    expect(await respuestaDe(await cargarOrdenEnAlcance("o-a-libre", tecnicoA, "leer", { tomaSinAsignar: false }))).toEqual(
      NO_AUTORIZADO,
    )
  })

  it("a branchless TECNICO keeps only his assigned orders (XC-4)", async () => {
    montar({ toma: true })

    expect("error" in (await cargarOrdenEnAlcance("o-a-t1", tecnicoSinSucursal, "editar"))).toBe(false)
    expect("error" in (await cargarOrdenEnAlcance("o-b-t1", tecnicoSinSucursal, "editar"))).toBe(false)
    expect(await respuestaDe(await cargarOrdenEnAlcance("o-a-libre", tecnicoSinSucursal, "leer"))).toEqual(NO_ENCONTRADA)
    expect(await respuestaDe(await cargarOrdenEnAlcance("o-a-t2", tecnicoSinSucursal, "leer"))).toEqual(NO_ENCONTRADA)
  })
})

// "Not found" is an answer about the order. A database that could not answer says nothing about it,
// so the caller gets a failure (the route's catch logs it and answers 500), not a 404 that would hide
// an outage behind "the order does not exist".
describe("cargarOrdenEnAlcance - a database that fails", () => {
  const conErrorDeLectura = (error: { code?: string; message: string }) =>
    montarSupabaseEnMemoria(
      { ordenes_servicio: ORDENES, organizations: [{ id: "org-1", tecnicos_toman_ordenes: false }] },
      { errorDeLectura: { ordenes_servicio: error } },
    )

  it.each([
    ["a statement timeout", { code: "57014", message: "canceling statement due to statement timeout" }],
    ["a connection failure", { code: "08006", message: "connection failure" }],
    ["a network failure, which carries no code", { code: "", message: "TypeError: fetch failed" }],
    ["an error with no code at all", { message: "boom" }],
  ])("%s is thrown, not answered as 'not found'", async (_nombre, error) => {
    conErrorDeLectura(error)

    // An Error (so the route's log says what happened, not "[object Object]") that keeps the code.
    const fallo = await cargarOrdenEnAlcance("o-a-t1", vendedorA, "ver").catch((e) => e)

    expect(fallo).toBeInstanceOf(Error)
    expect(fallo).toMatchObject(error)
  })

  it("'no rows' (PGRST116) is still the one answer a missing id gets, same as an order out of scope", async () => {
    montar({ toma: true })
    const fuera = await respuestaDe(await cargarOrdenEnAlcance("o-b-libre", vendedorA, "ver"))
    conErrorDeLectura({ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" })

    const sinFilas = await respuestaDe(await cargarOrdenEnAlcance("o-a-t1", vendedorA, "ver"))

    expect(sinFilas).toEqual(NO_ENCONTRADA)
    expect(sinFilas).toEqual(fuera)
  })

  it("a missing id still gets 'not found', not a failure", async () => {
    montar({ toma: true })

    expect(await respuestaDe(await cargarOrdenEnAlcance("no-existe", vendedorA, "ver"))).toEqual(NO_ENCONTRADA)
  })
})

describe("actorDeSesion", () => {
  it("takes the branch from the session requireAuth returned, and the rest from its result", () => {
    const resultado = {
      session: { user: { sucursalId: B } },
      organizationId: "org-1",
      userId: "u-9",
      role: "TECNICO",
    }

    expect(actorDeSesion(resultado)).toEqual({ organizationId: "org-1", userId: "u-9", role: "TECNICO", sucursalId: B })
  })

  it.each([
    ["no branch", { user: {} }],
    ["a null branch", { user: { sucursalId: null } }],
  ])("%s is null (XC-4: fail-closed)", (_nombre, session) => {
    expect(actorDeSesion({ session, organizationId: "org-1", userId: "u-9", role: "VENDEDOR" }).sucursalId).toBeNull()
  })
})
