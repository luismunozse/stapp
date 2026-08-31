import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, createPostRequest } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"
import { POST as expressPOST } from "@/app/api/reparaciones-express/route"

vi.mock("@/lib/subscriptions", () => ({ hasPlanFeature: vi.fn().mockResolvedValue(true) }))
vi.mock("@/lib/plan-limits", () => ({
  enforcePlanLimit: vi.fn().mockResolvedValue(null),
  isPlanLimitError: vi.fn().mockReturnValue(false),
  planLimitErrorResponse: vi.fn(),
}))
vi.mock("@/lib/tipos-dispositivo-config", () => ({ tipoValidaImei: vi.fn().mockResolvedValue(true) }))

import { hasPlanFeature } from "@/lib/subscriptions"

const url = "http://localhost/api/reparaciones-express"

function reparacion(over: Partial<any> = {}) {
  return {
    dispositivo: "iPhone 11 Pro", tipoDispositivo: "CELULAR",
    trabajoRealizado: "Cambio de pantalla", precio: 50000, ...over,
  }
}

function body(over: Partial<any> = {}) {
  return { clienteId: "c1", reparaciones: [reparacion()], ...over }
}

describe("reparaciones express", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(hasPlanFeature).mockResolvedValue(true)
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: {
        ordenes: [{ id: "o1", numeroOrden: 1, codigoOrden: "CEL001", dispositivo: "iPhone 11 Pro", precio: 50000, movimientoId: "mov1" }],
        totalCargado: 50000,
        saldoNuevo: -50000,
      },
      error: null,
    } as any)
    mockSupabaseFrom({
      organizations: createChainMock({ zona_horaria: "America/Argentina/Buenos_Aires" }),
      // audit.create() inserts into audit_logs once per created order. Without
      // this mock the default "No mock for table" error makes logAudit print
      // a console.error, and the GREEN run must be free of stderr noise.
      audit_logs: createChainMock(null, null),
    })
  })

  it("crea el lote y llama a la RPC con las reparaciones", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    const res = await expressPOST(createPostRequest(body(), url))

    expect(res.status).toBe(201)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "crear_reparaciones_express",
      expect.objectContaining({
        p_organization_id: "org-1",
        p_cliente_id: "c1",
        p_reparaciones: expect.arrayContaining([
          expect.objectContaining({ dispositivo: "iPhone 11 Pro", precio: 50000 }),
        ]),
      })
    )
  })

  it("genera un publicToken por reparacion", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    await expressPOST(createPostRequest(
      body({ reparaciones: [reparacion(), reparacion({ dispositivo: "Motorola G8" })] }), url
    ))

    const call = vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as any
    const tokens = call.p_reparaciones.map((r: any) => r.publicToken)
    expect(tokens).toHaveLength(2)
    expect(tokens[0]).toBeTruthy()
    expect(tokens[0]).not.toBe(tokens[1])
  })

  it("rechaza si el plan no tiene la feature", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(hasPlanFeature).mockResolvedValue(false)

    const res = await expressPOST(createPostRequest(body(), url))

    expect(res.status).toBe(403)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("rechaza un IMEI invalido para un tipo que lo exige", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    const res = await expressPOST(createPostRequest(
      body({ reparaciones: [reparacion({ imei: "123" })] }), url
    ))

    expect(res.status).toBe(400)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("rechaza precio cero o negativo", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    const res = await expressPOST(createPostRequest(
      body({ reparaciones: [reparacion({ precio: 0 })] }), url
    ))

    expect(res.status).toBe(400)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("rechaza un lote vacio", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    const res = await expressPOST(createPostRequest(body({ reparaciones: [] }), url))

    expect(res.status).toBe(400)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("propaga la idempotencyKey a la RPC", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    await expressPOST(createPostRequest(body({ idempotencyKey: "abc-123" }), url))

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "crear_reparaciones_express",
      expect.objectContaining({ p_idempotency_key: "abc-123" })
    )
  })

  it("calcula fechaVencimientoGarantia cuando hay dias de garantia", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    await expressPOST(createPostRequest(
      body({ reparaciones: [reparacion({ diasGarantia: 30 })] }), url
    ))

    const call = vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as any
    expect(call.p_reparaciones[0].fechaVencimientoGarantia).toBeTruthy()
  })

  it("mapea 'Cliente no encontrado' de la RPC a 404, no a un 500 generico", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { message: "Cliente no encontrado" },
    } as any)

    const res = await expressPOST(createPostRequest(body(), url))
    const json = await res.json()

    expect(res.status).toBe(404)
    expect(json.error).toBe("Cliente no encontrado")
  })

  it("devuelve la respuesta original cuando la RPC informa un replay", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const originalResponse = {
      ordenes: [{ id: "o1", numeroOrden: 1, codigoOrden: "CEL001", dispositivo: "iPhone 11 Pro", precio: 50000, movimientoId: "mov1" }],
      totalCargado: 50000,
      saldoNuevo: -50000,
    }
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { replayed: true, response: originalResponse },
      error: null,
    } as any)

    const res = await expressPOST(createPostRequest(body({ idempotencyKey: "abc-123" }), url))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json).toEqual(originalResponse)
    expect(json.replayed).toBeUndefined()
  })
})
