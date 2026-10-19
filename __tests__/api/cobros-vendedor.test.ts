/**
 * POST /api/ordenes/[id]/cobros — who may register a cobro.
 *
 * ADMIN always. VENDEDOR only when the org enabled `vendedores_manejan_caja`
 * AND the order belongs to the vendedor's own sucursal (the order id travels in
 * the URL, so the branch scope must be enforced server-side). DELETE (anular)
 * stays ADMIN-only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  createPostRequest,
  parseResponse,
} from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_cache: vi.fn((fn: any) => fn),
}))

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({
    create: vi.fn().mockResolvedValue(undefined),
  })),
}))

import { POST, DELETE } from "@/app/api/ordenes/[id]/cobros/route"

function createParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

const body = { pagos: [{ monto: 100, metodo: "EFECTIVO" }] }

function ordenRow(over: Partial<any> = {}) {
  return {
    id: "o1",
    costo_final: "1000",
    total_cobrado: "0",
    estado_cobro: "PENDIENTE",
    descuento_cobro: "0",
    cliente_id: "c1",
    organization_id: "org-1",
    estado: "EN_REPARACION",
    sucursal_id: "suc-B",
    ...over,
  }
}

/** `orgChain` null => the flag read fails (throws). */
function mockTables(opts: { flag?: boolean | null; unresolvable?: "throw" | "error"; orden?: any } = {}) {
  const orgChain = createChainMock({ vendedores_manejan_caja: opts.flag ?? false, zona_horaria: "America/Argentina/Buenos_Aires" })
  if (opts.unresolvable === "throw") {
    orgChain.single = vi.fn().mockRejectedValue(new Error("boom"))
  } else if (opts.unresolvable === "error") {
    orgChain.single = vi.fn().mockResolvedValue({ data: null, error: { message: "column does not exist" } })
  }
  vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
    if (table === "organizations") return orgChain as any
    if (table === "ordenes_servicio") return createChainMock(opts.orden ?? ordenRow()) as any
    return createChainMock(null) as any
  }) as any)
  vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
    if (fn === "registrar_cobros_orden_atomica") {
      return Promise.resolve({
        data: {
          replayed: false,
          response: {
            cobros: [{ id: "cob1", monto: 100, metodo: "EFECTIVO", cuotas: null }],
            orden: { totalCobrado: 100, estadoCobro: "PARCIAL", descuento: 0 },
          },
        },
        error: null,
      })
    }
    return Promise.resolve({ data: null, error: null })
  }) as any)
  return orgChain
}

const rpcCobro = () =>
  vi.mocked(supabaseAdmin.rpc).mock.calls.filter(([fn]) => fn === "registrar_cobros_orden_atomica")

async function post() {
  const res = await POST(createPostRequest(body, "http://localhost/api/ordenes/o1/cobros"), createParams("o1"))
  return parseResponse(res)
}

describe("POST /api/ordenes/[id]/cobros — acceso por rol", () => {
  beforeEach(() => vi.clearAllMocks())

  it("ADMIN registra el cobro sin consultar el flag", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const orgChain = mockTables()
    const { status } = await post()
    expect(status).toBe(201)
    expect(orgChain.select).not.toHaveBeenCalledWith("vendedores_manejan_caja")
  })

  it("ADMIN con sucursal distinta a la de la orden sigue pudiendo (sin cambio de alcance)", async () => {
    mockAuthSuccess({ role: "ADMIN", sucursalId: "suc-A" })
    mockTables()
    const { status } = await post()
    expect(status).toBe(201)
  })

  it("VENDEDOR con el flag prendido y orden de su sucursal registra el cobro", async () => {
    mockAuthSuccess({ role: "VENDEDOR", sucursalId: "suc-B" })
    const orgChain = mockTables({ flag: true })
    const { status } = await post()
    expect(status).toBe(201)
    // Guard against a mock that ignores the SELECT: the flag column must be asked for.
    expect(orgChain.select).toHaveBeenCalledWith("vendedores_manejan_caja")
    expect(rpcCobro()).toHaveLength(1)
  })

  it("VENDEDOR con el flag apagado: 403 y no escribe", async () => {
    mockAuthSuccess({ role: "VENDEDOR", sucursalId: "suc-B" })
    mockTables({ flag: false })
    const { status } = await post()
    expect(status).toBe(403)
    expect(rpcCobro()).toHaveLength(0)
  })

  it("VENDEDOR con el permiso irresoluble (la lectura lanza): 403, fail-closed", async () => {
    mockAuthSuccess({ role: "VENDEDOR", sucursalId: "suc-B" })
    mockTables({ unresolvable: "throw" })
    const { status } = await post()
    expect(status).toBe(403)
    expect(rpcCobro()).toHaveLength(0)
  })

  it("VENDEDOR con el permiso irresoluble (columna sin migrar / error de lectura): 403", async () => {
    mockAuthSuccess({ role: "VENDEDOR", sucursalId: "suc-B" })
    mockTables({ unresolvable: "error" })
    const { status } = await post()
    expect(status).toBe(403)
    expect(rpcCobro()).toHaveLength(0)
  })

  it("TECNICO: 403 aunque el flag esté prendido", async () => {
    mockAuthSuccess({ role: "TECNICO", sucursalId: "suc-B" })
    mockTables({ flag: true })
    const { status } = await post()
    expect(status).toBe(403)
    expect(rpcCobro()).toHaveLength(0)
  })
})

describe("POST /api/ordenes/[id]/cobros — alcance por sucursal del VENDEDOR", () => {
  beforeEach(() => vi.clearAllMocks())

  it("VENDEDOR de otra sucursal: 404 y no escribe", async () => {
    mockAuthSuccess({ role: "VENDEDOR", sucursalId: "suc-A" })
    mockTables({ flag: true }) // la orden es de suc-B
    const { status } = await post()
    expect(status).toBe(404)
    expect(rpcCobro()).toHaveLength(0)
  })

  it("VENDEDOR sin sucursal asignada: 404, fail-closed", async () => {
    mockAuthSuccess({ role: "VENDEDOR", sucursalId: null })
    mockTables({ flag: true })
    const { status } = await post()
    expect(status).toBe(404)
    expect(rpcCobro()).toHaveLength(0)
  })

  it("VENDEDOR sobre una orden sin sucursal_id: 404, fail-closed", async () => {
    mockAuthSuccess({ role: "VENDEDOR", sucursalId: "suc-B" })
    mockTables({ flag: true, orden: ordenRow({ sucursal_id: null }) })
    const { status } = await post()
    expect(status).toBe(404)
    expect(rpcCobro()).toHaveLength(0)
  })
})

describe("DELETE /api/ordenes/[id]/cobros — anular sigue siendo solo ADMIN", () => {
  beforeEach(() => vi.clearAllMocks())

  it("VENDEDOR con el flag prendido: 403", async () => {
    mockAuthSuccess({ role: "VENDEDOR", sucursalId: "suc-B" })
    mockTables({ flag: true })
    const res = await DELETE(
      new Request("http://localhost/api/ordenes/o1/cobros?cobroId=c1", { method: "DELETE" }),
      createParams("o1")
    )
    const { status } = await parseResponse(res)
    expect(status).toBe(403)
    expect(vi.mocked(supabaseAdmin.rpc)).not.toHaveBeenCalled()
  })
})
