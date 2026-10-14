import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, mockAuthError, createChainMock, createGetRequest, parseResponse } from "./helpers"
import { GET } from "@/app/api/ordenes/[id]/notas-credito/route"

const params = (id: string) => ({ params: Promise.resolve({ id }) })
const get = (id = "o-1") => GET(createGetRequest(`http://localhost/api/ordenes/${id}/notas-credito`), params(id))

const filaVista = {
  id: "nc-1", origen: "ORDEN", origen_id: "o-1", origen_numero: "CEL099", numero: "NC-000003",
  fecha: "2026-10-13T15:00:00+00:00", modo: "MONTO", motivo_nc: "OTRO", detalle: null,
  monto: "500.00", monto_aplicado_deuda: "0.00", monto_reembolso: "500.00", metodo: "EFECTIVO",
  cliente_id: null, sucursal_id: null, organization_id: "org-1", user_id: null, anulada: false,
}

function setup(orden: unknown) {
  const chains: Record<string, ReturnType<typeof createChainMock>> = {}
  vi.mocked(supabaseAdmin.from).mockImplementation((t: string) => {
    chains[t] = t === "ordenes_servicio" ? createChainMock(orden) : t === "v_notas_credito" ? createChainMock([filaVista]) : createChainMock([])
    return chains[t] as any
  })
  return chains
}

describe("GET /api/ordenes/[id]/notas-credito", () => {
  beforeEach(() => vi.clearAllMocks())

  it("sin sesión responde 401", async () => {
    mockAuthError()
    expect((await get()).status).toBe(401)
  })

  it("una orden de otra organización (o inexistente) es 404 y no se lee la vista", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const chains = setup(null)
    const res = await parseResponse(await get())
    expect(res.status).toBe(404)
    expect(chains.ordenes_servicio.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(supabaseAdmin.from).not.toHaveBeenCalledWith("v_notas_credito")
  })

  it("el técnico no ve las NC de una orden de otro técnico", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: "tec-1" })
    setup({ id: "o-1", tecnico_id: "tec-2" })
    expect((await get()).status).toBe(404)
    expect(supabaseAdmin.from).not.toHaveBeenCalledWith("v_notas_credito")
  })

  it.each([
    ["ADMIN", "user-1"],
    ["VENDEDOR", "user-1"],
    ["TECNICO", "tec-1"],
  ])("%s que ve la orden recibe sus NC desde la vista", async (role, userId) => {
    mockAuthSuccess({ role, userId })
    const chains = setup({ id: "o-1", tecnico_id: "tec-1" })
    const res = await parseResponse(await get())
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0]).toMatchObject({ numero: "NC-000003", origenNumero: "CEL099", motivo: "Otro" })
    expect(chains.v_notas_credito.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(chains.v_notas_credito.eq).toHaveBeenCalledWith("origen", "ORDEN")
    expect(chains.v_notas_credito.eq).toHaveBeenCalledWith("origen_id", "o-1")
    expect(chains.v_notas_credito.order).toHaveBeenNthCalledWith(1, "fecha", { ascending: false })
  })
})
