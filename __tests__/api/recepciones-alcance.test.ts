// @vitest-environment node
/**
 * The detail of a multi-device reception under branch isolation (change sucursales-aislamiento, PR5;
 * OI-1, XC-1, XC-2): it lists the orders of the reception, so it follows the reception's branch. Staff
 * of another branch get the same answer as for a reception that does not exist; an ADMIN reads any.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { cookies } from "next/headers"
import { SUCURSAL_COOKIE } from "@/lib/sucursal"
import { mockAuthSuccess, parseResponse } from "./helpers"
import { montarSupabaseEnMemoria } from "../helpers/supabase-memoria"
import { GET } from "@/app/api/recepciones/[id]/route"

vi.mock("@/lib/subscriptions", () => ({ hasPlanFeature: vi.fn().mockResolvedValue(true) }))

const A = "suc-A"
const B = "suc-B"

const recepcion = (id: string, sucursal: string | null) => ({
  id,
  organization_id: "org-1",
  sucursal_id: sucursal,
  numero: 1,
  codigo: `REC-${id}`,
  cliente_id: "cl-1",
  descuento_tipo: null,
  descuento_valor: null,
  observaciones: null,
  created_at: "2026-10-01T10:00:00Z",
  clientes: { nombre: "Cliente" },
})

const orden = (id: string, recepcionId: string, sucursal: string) => ({
  id,
  organization_id: "org-1",
  sucursal_id: sucursal,
  recepcion_id: recepcionId,
  numero_orden: Number(id.replace(/\D/g, "")),
  codigo_orden: `CEL-${id}`,
  dispositivo: `Galaxy ${id}`,
  marca: "Samsung",
  estado: "EN_REPARACION",
  presupuesto: 100,
  costo_final: null,
  descuento_cobro: null,
})

const RECEPCIONES = [recepcion("rA", A), recepcion("rB", B)]
const ORDENES = [orden("o11", "rA", A), orden("o12", "rA", A), orden("o21", "rB", B)]

async function abrir(role: string, sucursalId: string | null, id: string, opciones: { cookie?: string; ordenes?: typeof ORDENES } = {}) {
  mockAuthSuccess({ role, userId: "u-1", sucursalId })
  vi.mocked(cookies).mockResolvedValue({
    get: (nombre: string) => (nombre === SUCURSAL_COOKIE && opciones.cookie ? { value: opciones.cookie } : undefined),
    set: vi.fn(),
  } as any)
  montarSupabaseEnMemoria({ recepciones: RECEPCIONES, ordenes_servicio: opciones.ordenes ?? ORDENES })
  const res = await GET(new Request(`http://localhost:3000/api/recepciones/${id}`), { params: Promise.resolve({ id }) })
  const { status, body } = await parseResponse(res)
  return { status, body, ordenes: ((body.ordenes ?? []) as Array<{ id: string }>).map((o) => o.id).sort() }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/recepciones/[id]", () => {
  it.each([
    ["a VENDEDOR of A", "VENDEDOR", A, "rA", ["o11", "o12"]],
    ["a TECNICO of A", "TECNICO", A, "rA", ["o11", "o12"]],
    ["a VENDEDOR of B", "VENDEDOR", B, "rB", ["o21"]],
    ["an ADMIN, reception of A", "ADMIN", null, "rA", ["o11", "o12"]],
    ["an ADMIN, reception of B", "ADMIN", null, "rB", ["o21"]],
  ])("%s opens the reception with its orders", async (_quien, role, sucursal, id, esperadas) => {
    const { status, ordenes } = await abrir(role, sucursal, id)
    expect(status).toBe(200)
    expect(ordenes).toEqual(esperadas)
  })

  it.each([
    ["a VENDEDOR of B opening A's reception", "VENDEDOR", B, "rA"],
    ["a TECNICO of B opening A's reception", "TECNICO", B, "rA"],
    ["a VENDEDOR of A opening B's reception", "VENDEDOR", A, "rB"],
    ["a VENDEDOR without a branch", "VENDEDOR", null, "rA"],
  ])("%s: the same answer as a reception that does not exist", async (_caso, role, sucursal, id) => {
    const fuera = await abrir(role, sucursal, id)
    const inexistente = await abrir(role, sucursal, "no-existe")
    expect(fuera.status).toBe(404)
    expect(fuera.body).toEqual(inexistente.body)
    expect(fuera.ordenes).toEqual([])
  })

  it("an ADMIN reads a reception by its id whatever branch the switcher has selected", async () => {
    const { status, ordenes } = await abrir("ADMIN", null, "rA", { cookie: B })
    expect(status).toBe(200)
    expect(ordenes).toEqual(["o11", "o12"])
  })

  it("an order of another branch that sits in the reception is not listed to the branch's staff", async () => {
    // Not a state the app creates (a reception's orders are taken in at its branch): the listing does
    // not depend on it.
    const conOrdenAjena = [...ORDENES, orden("o13", "rA", B)]
    const { ordenes } = await abrir("VENDEDOR", A, "rA", { ordenes: conOrdenAjena })
    expect(ordenes).toEqual(["o11", "o12"])
    expect((await abrir("ADMIN", null, "rA", { ordenes: conOrdenAjena })).ordenes).toEqual(["o11", "o12", "o13"])
  })

  it("the orders of the reception are read only after the reception passes the scope", async () => {
    mockAuthSuccess({ role: "VENDEDOR", userId: "u-1", sucursalId: B })
    const memoria = montarSupabaseEnMemoria({ recepciones: RECEPCIONES, ordenes_servicio: ORDENES })
    await GET(new Request("http://localhost:3000/api/recepciones/rA"), { params: Promise.resolve({ id: "rA" }) })
    expect(memoria.lecturas).not.toContain("ordenes_servicio")
  })
})
