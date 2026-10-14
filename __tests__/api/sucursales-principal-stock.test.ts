import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createPostRequest, parseResponse } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/plan-limits", () => ({
  enforcePlanLimit: vi.fn().mockResolvedValue(null),
}))

import { POST } from "@/app/api/sucursales/route"
import { PUT } from "@/app/api/sucursales/[id]/route"

type Result = { data: any; error: any }
type Call = { table: string; method: string; args: any[] }

/**
 * Mock de supabaseAdmin.from() que consume resultados POR ORDEN de llamada a cada
 * tabla y registra TODOS los metodos encadenados (para asertar los filtros que la
 * logica necesita: org, sucursal, stock > 0). Un mock que ignora los filtros da
 * falsos verdes.
 */
function mockTables(tables: Record<string, Result[]>) {
  const calls: Call[] = []
  const queues = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, [...v]]))
  vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
    const result = queues[table]?.shift() ?? { data: null, error: { message: `No mock for ${table}` } }
    const chain: any = {}
    for (const method of [
      "select", "insert", "update", "eq", "neq", "in", "is", "gt", "order", "range", "limit",
    ]) {
      chain[method] = vi.fn((...args: any[]) => {
        calls.push({ table, method, args })
        return chain
      })
    }
    chain.single = vi.fn().mockResolvedValue(result)
    chain.maybeSingle = vi.fn().mockResolvedValue(result)
    chain.then = (resolve: any, reject?: any) => Promise.resolve(result).then(resolve, reject)
    return chain
  }) as any)
  return calls
}

const callsTo = (calls: Call[], table: string, method: string) =>
  calls.filter((c) => c.table === table && c.method === method)

const PRINCIPAL = { id: "suc-colon", nombre: "Colón" }
const existingRioja = (principal = false) => ({ data: { id: "suc-rioja", principal, activo: true }, error: null })
const rowsConStock = [
  { inventario_id: "i1", stock: 10 },
  { inventario_id: "i2", stock: 5 },
  { inventario_id: "i1", stock: 3 }, // mismo item en otro deposito de la principal
]

const putReq = (body: any) =>
  new Request("http://localhost:3000/api/sucursales/suc-rioja", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
const params = { params: Promise.resolve({ id: "suc-rioja" }) }

describe("cambio de sucursal principal con stock", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1", userId: "u-1" })
  })

  it("PUT promover con stock en la principal actual y sin flag: 409 y no escribe nada", async () => {
    const calls = mockTables({
      sucursales: [existingRioja(), { data: PRINCIPAL, error: null }],
      depositos: [{ data: [{ id: "dep-1" }, { id: "dep-2" }], error: null }],
      inventario_depositos: [{ data: rowsConStock, error: null }],
    })

    const res = await PUT(putReq({ principal: true }), params)
    const { status, body } = await parseResponse(res)

    expect(status).toBe(409)
    expect(body).toMatchObject({
      code: "PRINCIPAL_CON_STOCK",
      sucursalActual: "Colón",
      items: 2,
      unidades: 18,
    })
    expect(typeof body.error).toBe("string")
    expect(callsTo(calls, "sucursales", "update")).toHaveLength(0)
    // Filtros que la cuenta necesita
    expect(callsTo(calls, "depositos", "eq")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ args: ["organization_id", "org-1"] }),
        expect.objectContaining({ args: ["sucursal_id", "suc-colon"] }),
      ])
    )
    expect(callsTo(calls, "depositos", "is")).toEqual(
      expect.arrayContaining([expect.objectContaining({ args: ["deleted_at", null] })])
    )
    expect(callsTo(calls, "inventario_depositos", "eq")).toEqual(
      expect.arrayContaining([expect.objectContaining({ args: ["organization_id", "org-1"] })])
    )
    expect(callsTo(calls, "inventario_depositos", "in")[0].args).toEqual(["deposito_id", ["dep-1", "dep-2"]])
    expect(callsTo(calls, "inventario_depositos", "gt")[0].args).toEqual(["stock", 0])
    expect(callsTo(calls, "inventario_depositos", "is")).toEqual(
      expect.arrayContaining([expect.objectContaining({ args: ["inventario.deleted_at", null] })])
    )
  })

  it("PUT promover con el flag: demote + update como hasta ahora", async () => {
    const calls = mockTables({
      sucursales: [
        existingRioja(),
        { data: PRINCIPAL, error: null },
        { data: null, error: null }, // demote
        { data: { id: "suc-rioja", nombre: "Rioja", principal: true, activo: true }, error: null },
      ],
      depositos: [{ data: [{ id: "dep-1" }], error: null }],
      inventario_depositos: [{ data: rowsConStock, error: null }],
    })

    const res = await PUT(putReq({ principal: true, confirmarCambioPrincipal: true }), params)
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    const updates = callsTo(calls, "sucursales", "update")
    expect(updates).toHaveLength(2)
    expect(updates[0].args[0]).toEqual({ principal: false })
    expect(updates[1].args[0]).toEqual({ principal: true })
    // El flag nunca se escribe a la base
    expect(JSON.stringify(updates)).not.toContain("confirmarCambioPrincipal")
  })

  it("PUT promover sin stock en la principal: 200 sin flag", async () => {
    const calls = mockTables({
      sucursales: [
        existingRioja(),
        { data: PRINCIPAL, error: null },
        { data: null, error: null },
        { data: { id: "suc-rioja", principal: true, activo: true }, error: null },
      ],
      depositos: [{ data: [{ id: "dep-1" }], error: null }],
      inventario_depositos: [{ data: [], error: null }],
    })

    const res = await PUT(putReq({ principal: true }), params)
    expect((await parseResponse(res)).status).toBe(200)
    expect(callsTo(calls, "sucursales", "update")).toHaveLength(2)
  })

  it("PUT que no cambia la principal (renombrar): no consulta stock", async () => {
    const calls = mockTables({
      sucursales: [
        existingRioja(),
        { data: { id: "suc-rioja", nombre: "Rioja 2", principal: false, activo: true }, error: null },
      ],
    })

    const res = await PUT(putReq({ nombre: "Rioja 2" }), params)
    expect((await parseResponse(res)).status).toBe(200)
    expect(calls.filter((c) => c.table === "depositos" || c.table === "inventario_depositos")).toHaveLength(0)
  })

  it("PUT editando la propia principal con principal:true: no consulta stock", async () => {
    const calls = mockTables({
      sucursales: [
        existingRioja(true),
        { data: { id: "suc-rioja", nombre: "Rioja", principal: true, activo: true }, error: null },
      ],
    })

    const res = await PUT(putReq({ nombre: "Rioja", principal: true }), params)
    expect((await parseResponse(res)).status).toBe(200)
    expect(calls.filter((c) => c.table === "depositos" || c.table === "inventario_depositos")).toHaveLength(0)
  })

  it("PUT con error en el conteo: 500 y no escribe", async () => {
    const calls = mockTables({
      sucursales: [existingRioja(), { data: PRINCIPAL, error: null }],
      depositos: [{ data: [{ id: "dep-1" }], error: null }],
      inventario_depositos: [{ data: null, error: { message: "boom" } }],
    })

    const res = await PUT(putReq({ principal: true }), params)
    expect((await parseResponse(res)).status).toBe(500)
    expect(callsTo(calls, "sucursales", "update")).toHaveLength(0)
  })

  it("POST crear con principal:true con stock en la actual y sin flag: 409 y no escribe", async () => {
    const calls = mockTables({
      sucursales: [{ data: PRINCIPAL, error: null }],
      depositos: [{ data: [{ id: "dep-1" }], error: null }],
      inventario_depositos: [{ data: rowsConStock, error: null }],
    })

    const res = await POST(createPostRequest({ nombre: "Nueva", principal: true }, "http://localhost:3000/api/sucursales"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(409)
    expect(body).toMatchObject({ code: "PRINCIPAL_CON_STOCK", sucursalActual: "Colón", items: 2, unidades: 18 })
    expect(callsTo(calls, "sucursales", "update")).toHaveLength(0)
    expect(callsTo(calls, "sucursales", "insert")).toHaveLength(0)
  })

  it("POST crear con principal:true y el flag: 201 como hasta ahora", async () => {
    const calls = mockTables({
      sucursales: [
        { data: PRINCIPAL, error: null },
        { data: null, error: null }, // demote
        { data: { id: "suc-nueva", nombre: "Nueva", principal: true, activo: true }, error: null },
      ],
      depositos: [{ data: [{ id: "dep-1" }], error: null }],
      inventario_depositos: [{ data: rowsConStock, error: null }],
    })

    const res = await POST(
      createPostRequest(
        { nombre: "Nueva", principal: true, confirmarCambioPrincipal: true },
        "http://localhost:3000/api/sucursales"
      )
    )
    expect((await parseResponse(res)).status).toBe(201)
    const inserts = callsTo(calls, "sucursales", "insert")
    expect(inserts).toHaveLength(1)
    expect(JSON.stringify(inserts[0].args)).not.toContain("confirmarCambioPrincipal")
  })

  it("POST sin principal:true: no consulta stock", async () => {
    const calls = mockTables({
      sucursales: [{ data: { id: "suc-n", nombre: "N", principal: false, activo: true }, error: null }],
    })

    const res = await POST(createPostRequest({ nombre: "N" }, "http://localhost:3000/api/sucursales"))
    expect((await parseResponse(res)).status).toBe(201)
    expect(calls.filter((c) => c.table === "depositos" || c.table === "inventario_depositos")).toHaveLength(0)
  })

  it("POST principal:true sin principal actual (org nueva): no hay stock que proteger", async () => {
    mockTables({
      sucursales: [
        { data: null, error: null }, // no hay principal
        { data: null, error: null }, // demote
        { data: { id: "suc-n", nombre: "N", principal: true, activo: true }, error: null },
      ],
    })

    const res = await POST(createPostRequest({ nombre: "N", principal: true }, "http://localhost:3000/api/sucursales"))
    expect((await parseResponse(res)).status).toBe(201)
  })
})
