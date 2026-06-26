// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockSupabaseFrom,
  createChainMock,
  createPostRequest,
  parseResponse,
} from "./helpers"
import { GET, PUT } from "@/app/api/configuracion/recargos-metodo/route"

describe("/api/configuracion/recargos-metodo", () => {
  beforeEach(() => vi.clearAllMocks())

  it("GET devuelve 200 con la lista de métodos", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({
      recargos_metodo_pago: createChainMock([
        { metodo_pago: "CUENTA_CORRIENTE", porcentaje: "15" },
      ]),
    })
    const res = await GET(
      new Request("http://localhost/api/configuracion/recargos-metodo")
    )
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(
      body.recargos.find((r: any) => r.metodo === "CUENTA_CORRIENTE").porcentaje
    ).toBe(15)
    expect(
      body.recargos.find((r: any) => r.metodo === "EFECTIVO").porcentaje
    ).toBe(0)
  })

  it("PUT como VENDEDOR => 403", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })
    const res = await PUT(
      new Request(
        "http://localhost/api/configuracion/recargos-metodo",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recargos: [{ metodo: "CUENTA_CORRIENTE", porcentaje: 15 }],
          }),
        }
      )
    )
    const { status } = await parseResponse(res)
    expect(status).toBe(403)
  })

  it("PUT con porcentaje negativo => 400", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({ recargos_metodo_pago: createChainMock(null) })
    const res = await PUT(
      new Request(
        "http://localhost/api/configuracion/recargos-metodo",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recargos: [{ metodo: "CUENTA_CORRIENTE", porcentaje: -5 }],
          }),
        }
      )
    )
    const { status } = await parseResponse(res)
    expect(status).toBe(400)
  })
})
