/**
 * Tests: GET /api/facturacion/candidatos returns uninvoiced REPARADO/ENTREGADO
 * ordenes and uninvoiced COMPLETADA ventas, filtering out anything that
 * already has a factura.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { cookies } from "next/headers"
import { mockAuthSuccess, createChainMock, createGetRequest, parseResponse } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"
import { SUCURSAL_COOKIE } from "@/lib/sucursal"

import { GET as candidatosGet } from "@/app/api/facturacion/candidatos/route"

function chainableThenable(result: { data: any; error: any }) {
  const chain: any = {}
  const methods = ["select", "eq", "in", "order", "limit"]
  for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain)
  chain.then = (resolve: any) => Promise.resolve(result).then(resolve)
  return chain
}

// ADMIN's branch filter is resolved from the "active sucursal" cookie
// (see lib/sucursal.ts sucursalParaLectura). Controlling it here lets us
// assert the filter actually reaches both the ordenes and the ventas query.
function mockCookie(value: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn((name: string) => (name === SUCURSAL_COOKIE && value ? { value } : undefined)),
    set: vi.fn(),
  } as any)
}

// Installs per-table mocks and returns both underlying chains so tests can
// assert on their individual `.eq(...)` call history — this is what catches
// a sucursal filter silently failing to reach one of the two queries.
function mockCandidatosQueries(
  ordenesResult: { data: any; error: any },
  ventasResult: { data: any; error: any }
) {
  const ordenesChain = chainableThenable(ordenesResult)
  const ventasChain = chainableThenable(ventasResult)
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table === "ordenes_servicio") return ordenesChain
    if (table === "ventas") return ventasChain
    return chainableThenable({ data: null, error: { message: `No mock for table: ${table}` } })
  })
  return { ordenesChain, ventasChain }
}

describe("GET /api/facturacion/candidatos", () => {
  beforeEach(() => vi.clearAllMocks())

  it("excludes ordenes and ventas that already have a factura", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ordenes_servicio") {
        return createChainMock([
          { id: "o1", numero_orden: 1, codigo_orden: "CEL001", dispositivo: "iPhone", clientes: { nombre: "Ana" }, facturas: [] },
          { id: "o2", numero_orden: 2, codigo_orden: "CEL002", dispositivo: "Samsung", clientes: { nombre: "Beto" }, facturas: [{ id: "f-existing" }] },
        ]) as any
      }
      if (table === "ventas") {
        return createChainMock([
          { id: "v1", numero_venta: 5, cliente_nombre: "Consumidor Final", total: 200, facturas: [] },
          { id: "v2", numero_venta: 6, cliente_nombre: "Carla", total: 300, facturas: [{ id: "f-existing-2" }] },
        ]) as any
      }
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    })

    const res = await candidatosGet(createGetRequest("http://localhost:3000/api/facturacion/candidatos"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.ordenes).toHaveLength(1)
    expect(body.ordenes[0].id).toBe("o1")
    expect(body.ventas).toHaveLength(1)
    expect(body.ventas[0].id).toBe("v1")
  })
})

describe("GET /api/facturacion/candidatos — sucursal filter reaches both queries", () => {
  beforeEach(() => vi.clearAllMocks())

  it("applies the sucursal filter to both the ordenes query and the ventas query when a branch is scoped", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-B")

    const { ordenesChain, ventasChain } = mockCandidatosQueries(
      { data: [], error: null },
      { data: [], error: null }
    )

    const res = await candidatosGet(createGetRequest("http://localhost:3000/api/facturacion/candidatos"))

    expect(res.status).toBe(200)
    expect(ordenesChain.eq.mock.calls).toContainEqual(["sucursal_id", "suc-B"])
    expect(ventasChain.eq.mock.calls).toContainEqual(["sucursal_id", "suc-B"])
  })

  it("does not apply a sucursal filter to either query when the ADMIN is viewing all branches", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie(null) // no cookie => verTodas

    const { ordenesChain, ventasChain } = mockCandidatosQueries(
      { data: [], error: null },
      { data: [], error: null }
    )

    const res = await candidatosGet(createGetRequest("http://localhost:3000/api/facturacion/candidatos"))

    expect(res.status).toBe(200)
    expect(ordenesChain.eq.mock.calls.find((c: any[]) => c[0] === "sucursal_id")).toBeUndefined()
    expect(ventasChain.eq.mock.calls.find((c: any[]) => c[0] === "sucursal_id")).toBeUndefined()
  })
})
