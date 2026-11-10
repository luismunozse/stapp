import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"
import { DELETE } from "@/app/api/clientes/[id]/route"

const params = { params: Promise.resolve({ id: "cli-1" }) }
const req = () => new Request("http://localhost:3000/api/clientes/cli-1", { method: "DELETE" })

/** Tablas que referencian al cliente: todas vacías salvo las que se pasen con count > 0. */
function mockHistorial(counts: Partial<Record<string, number>> = {}) {
  const clientes = createChainMock({ id: "cli-1" }, null)
  const tablas: Record<string, ReturnType<typeof createChainMock>> = { clientes }
  for (const t of ["ordenes_servicio", "recepciones", "cuenta_corriente", "ventas", "cotizaciones"]) {
    tablas[t] = createChainMock(null, null, counts[t] ?? 0)
  }
  mockSupabaseFrom(tablas)
  return tablas
}

describe("DELETE /api/clientes/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(["TECNICO", "VENDEDOR"])("rechaza con 403 a un %s y no borra nada", async (role) => {
    mockAuthSuccess({ role })
    const tablas = mockHistorial()

    const { status } = await parseResponse(await DELETE(req(), params))

    expect(status).toBe(403)
    expect(tablas.clientes.delete).not.toHaveBeenCalled()
  })

  it.each(["ordenes_servicio", "recepciones", "cuenta_corriente", "ventas", "cotizaciones"])(
    "devuelve 409 si el cliente tiene registros en %s",
    async (tabla) => {
      mockAuthSuccess({ role: "ADMIN" })
      const tablas = mockHistorial({ [tabla]: 2 })

      const { status, body } = await parseResponse(await DELETE(req(), params))

      expect(status).toBe(409)
      expect(body.error).toMatch(/historial/i)
      expect(tablas.clientes.delete).not.toHaveBeenCalled()
      expect(tablas[tabla].eq).toHaveBeenCalledWith("organization_id", "org-1")
    }
  )

  it("un ADMIN borra un cliente sin historial, acotado a su organización", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const tablas = mockHistorial()

    const { status, body } = await parseResponse(await DELETE(req(), params))

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(tablas.clientes.delete).toHaveBeenCalled()
    expect(tablas.clientes.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("devuelve 404 si el cliente no es de la organización", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const tablas = mockHistorial()
    tablas.clientes.single.mockResolvedValue({ data: null, error: { code: "PGRST116" } })

    const { status } = await parseResponse(await DELETE(req(), params))

    expect(status).toBe(404)
    expect(tablas.clientes.delete).not.toHaveBeenCalled()
  })

  it("no borra si falla la consulta de historial", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const tablas = mockHistorial()
    tablas.ventas = createChainMock(null, { message: "boom" })
    vi.mocked(supabaseAdmin.from).mockImplementation((t: string) => tablas[t] as any)

    const { status } = await parseResponse(await DELETE(req(), params))

    expect(status).toBe(500)
    expect(tablas.clientes.delete).not.toHaveBeenCalled()
  })
})
