import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, createGetRequest, parseResponse } from "./helpers"
import { GET } from "@/app/api/ventas/route"

describe("GET /api/ventas — filtros de fecha y búsqueda", () => {
  beforeEach(() => vi.clearAllMocks())

  function setup() {
    const ventas = createChainMock([], null, 0)
    mockSupabaseFrom({
      ventas,
      organizations: createChainMock({ zona_horaria: "America/Argentina/Buenos_Aires" }),
    })
    return ventas
  }

  it("las fechas son días de la organización (hasta incluye la noche del último día)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const ventas = setup()
    await GET(createGetRequest("http://localhost/api/ventas?fechaDesde=2026-05-01&fechaHasta=2026-05-31"))
    expect(ventas.gte).toHaveBeenCalledWith("created_at", "2026-05-01T03:00:00.000Z")
    expect(ventas.lte).toHaveBeenCalledWith("created_at", "2026-06-01T02:59:59.999Z")
  })

  it("una búsqueda con coma no rompe el filtro (antes respondía 500)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const ventas = setup()
    const { status } = await parseResponse(await GET(createGetRequest("http://localhost/api/ventas?search=P%C3%A9rez%2C%20Juan")))
    expect(status).toBe(200)
    const filtro = vi.mocked(ventas.or).mock.calls[0][0] as string
    // tres condiciones, ninguna partida por la coma del nombre
    expect(filtro.split(",")).toHaveLength(3)
    expect(filtro).toContain("cliente_nombre.ilike.%Pérez Juan%")
  })

  it("un número busca también por número de venta; '12abc' no", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    let ventas = setup()
    await GET(createGetRequest("http://localhost/api/ventas?search=42"))
    expect(vi.mocked(ventas.or).mock.calls[0][0]).toContain("numero_venta.eq.42")

    ventas = setup()
    await GET(createGetRequest("http://localhost/api/ventas?search=12abc"))
    expect(vi.mocked(ventas.or).mock.calls[0][0]).not.toContain("numero_venta")
  })
})
