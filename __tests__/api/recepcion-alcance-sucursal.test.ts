/**
 * GET /api/recepciones/[id] — member orders follow the caller's branch scope.
 * `recepciones` has no branch column, so the batch is judged by its members.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, createGetRequest, parseResponse } from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
}))

import { GET } from "@/app/api/recepciones/[id]/route"

const S1 = "sucursal-1"
const S2 = "sucursal-2"
const U1 = "user-1"
const ctx = { params: Promise.resolve({ id: "rec-1" }) }

const recepcion = {
  id: "rec-1",
  numero: 1,
  codigo: "REC-001",
  cliente_id: "cli-1",
  descuento_tipo: null,
  descuento_valor: null,
  observaciones: null,
  created_at: "2026-08-01T00:00:00.000Z",
  clientes: { nombre: "Ana" },
}

function orden(id: string, sucursal_id: string | null, tecnico_id: string | null = null) {
  return {
    id,
    numero_orden: 1,
    codigo_orden: id,
    dispositivo: "Phone",
    marca: null,
    estado: "RECIBIDO",
    presupuesto: 100,
    costo_final: null,
    descuento_cobro: null,
    sucursal_id,
    tecnico_id,
  }
}

function montar(ordenes: any[]) {
  mockSupabaseFrom({
    recepciones: createChainMock(recepcion),
    ordenes_servicio: createChainMock(ordenes),
  })
}

describe("GET /api/recepciones/[id] branch scope", () => {
  beforeEach(() => vi.clearAllMocks())

  it("ADMIN sees every member", async () => {
    montar([orden("a", S1), orden("b", S2)])
    mockAuthSuccess({ role: "ADMIN" })
    const { body } = await parseResponse(await GET(createGetRequest(), ctx))
    expect(body.ordenes.map((o: any) => o.id)).toEqual(["a", "b"])
    expect(body.totales.subtotal).toBe(200)
  })

  it("VENDEDOR sees only the members of the current branch, totals included", async () => {
    montar([orden("a", S1), orden("b", S2)])
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    const { status, body } = await parseResponse(await GET(createGetRequest(), ctx))
    expect(status).toBe(200)
    expect(body.ordenes.map((o: any) => o.id)).toEqual(["a"])
    expect(body.totales.subtotal).toBe(100)
  })

  it("TECNICO also sees members assigned to them in another branch", async () => {
    montar([orden("a", S1), orden("b", S2, U1), orden("c", S2)])
    mockAuthSuccess({ role: "TECNICO", userId: U1, sucursalId: S1 })
    const { body } = await parseResponse(await GET(createGetRequest(), ctx))
    expect(body.ordenes.map((o: any) => o.id)).toEqual(["a", "b"])
  })

  it("no member in scope answers like a missing batch", async () => {
    montar([orden("b", S2)])
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    const { status, body } = await parseResponse(await GET(createGetRequest(), ctx))
    expect(status).toBe(404)
    expect(body.error).toBe("Recepcion no encontrada")
  })

  it("does not expose the scope columns in the response", async () => {
    montar([orden("a", S1)])
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    const { body } = await parseResponse(await GET(createGetRequest(), ctx))
    expect(body.ordenes[0]).not.toHaveProperty("sucursal_id")
    expect(body.ordenes[0]).not.toHaveProperty("tecnico_id")
  })
})
