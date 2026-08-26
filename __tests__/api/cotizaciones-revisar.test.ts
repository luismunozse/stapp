import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockAuthError, createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"

const call = async (id = "cot-1") => {
  const { POST } = await import("@/app/api/cotizaciones/[id]/revisar/route")
  return POST(
    new Request(`http://localhost:3000/api/cotizaciones/${id}/revisar`, { method: "POST" }) as any,
    { params: Promise.resolve({ id }) } as any
  )
}

describe("POST /api/cotizaciones/[id]/revisar", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it("rechaza sin sesion", async () => {
    mockAuthError()
    expect((await parseResponse(await call())).status).toBe(401)
  })

  it("solo revisa cotizaciones ACEPTADAS", async () => {
    mockSupabaseFrom({
      cotizaciones: createChainMock({ id: "cot-1", estado: "BORRADOR", organization_id: "org-1" }),
    })
    const { status } = await parseResponse(await call())
    expect(status).toBe(400)
  })

  it("no toca la cotizacion firmada: solo inserta la revision", async () => {
    const cotChain = createChainMock({
      id: "cot-1",
      estado: "ACEPTADA",
      organization_id: "org-1",
      orden_id: "orden-1",
      numero_cotizacion: "COT-0001",
      firma_aprobacion: "data:image/png;base64,AAA",
      total: 100,
    })
    mockSupabaseFrom({
      cotizaciones: cotChain,
      items_cotizacion: createChainMock([{ descripcion: "X", cantidad: 1, precio_unitario: 100 }]),
    })

    const { status } = await parseResponse(await call())

    expect(status).toBe(201)
    expect(cotChain.update).not.toHaveBeenCalled()
    expect(cotChain.insert).toHaveBeenCalled()
  })

  it("la revision nace en BORRADOR y conserva el numero de la original", async () => {
    const cotChain = createChainMock({
      id: "cot-1",
      estado: "ACEPTADA",
      organization_id: "org-1",
      orden_id: "orden-1",
      numero_cotizacion: "COT-0001",
      total: 100,
    })
    mockSupabaseFrom({
      cotizaciones: cotChain,
      items_cotizacion: createChainMock([{ descripcion: "X", cantidad: 1, precio_unitario: 100 }]),
    })

    await call()

    const insertado = cotChain.insert.mock.calls[0][0]
    expect(insertado).toEqual(
      expect.objectContaining({ estado: "BORRADOR", numero_cotizacion: "COT-0001", orden_id: "orden-1" })
    )
    // La firma es de la original y no se hereda: la revision se firma de nuevo.
    expect(insertado.firma_aprobacion ?? null).toBeNull()
  })
})
