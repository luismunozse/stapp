import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/mercadopago", () => ({
  createSubscription: vi.fn(),
}))

import { createSubscription } from "@/lib/mercadopago"
import { POST } from "@/app/api/mercadopago/preapproval/route"

describe("POST /api/mercadopago/preapproval", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // En produccion NEXTAUTH_URL es el dominio real. El default de desarrollo
    // es localhost, que MercadoPago rechaza como back_url — hay un test
    // dedicado a ese caso mas abajo.
    process.env.NEXTAUTH_URL = "https://stapp.com.ar"
    vi.mocked(createSubscription).mockResolvedValue({
      id: "pre-1",
      init_point: "https://mp.com/adherir/pre-1",
    } as never)
  })

  it("401 si no esta autenticado", async () => {
    mockAuthError()
    const res = await POST(createPostRequest({}) as never)
    const { status } = await parseResponse(res)
    expect(status).toBe(401)
  })

  it("404 si la organizacion esta inactiva", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      organizations: createChainMock({ id: "org-1", nombre: "Taller", activo: false }),
    })

    const res = await POST(createPostRequest({}) as never)
    const { status } = await parseResponse(res)
    expect(status).toBe(404)
  })

  it("devuelve el init_point de la adhesion", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      organizations: createChainMock({
        id: "org-1",
        nombre: "Taller",
        email: "taller@test.com",
        activo: true,
      }),
    })

    const res = await POST(createPostRequest({ planSlug: "profesional" }) as never)
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.initPoint).toBe("https://mp.com/adherir/pre-1")
    expect(body.preapprovalId).toBe("pre-1")
  })

  it("corta con un mensaje claro si la URL de retorno no es publica", async () => {
    // MercadoPago rechaza back_url con localhost: devuelve 400 "Invalid value
    // for back_url". Sin esta guarda el operador ve ese 400 opaco y no entiende
    // que el problema es su NEXTAUTH_URL de desarrollo.
    const original = process.env.NEXTAUTH_URL
    process.env.NEXTAUTH_URL = "http://localhost:3000"

    mockAuthSuccess()
    mockSupabaseFrom({
      organizations: createChainMock({
        id: "org-1",
        nombre: "Taller",
        email: "taller@test.com",
        activo: true,
      }),
    })

    const res = await POST(createPostRequest({}) as never)
    const { status, body } = await parseResponse(res)

    process.env.NEXTAUTH_URL = original

    expect(status).toBe(500)
    expect(body.error).toMatch(/pública/i)
    expect(vi.mocked(createSubscription)).not.toHaveBeenCalled()
  })

  it("le pasa a MercadoPago la organizacion del usuario, no la del request", async () => {
    mockAuthSuccess({ organizationId: "org-1" })
    mockSupabaseFrom({
      organizations: createChainMock({
        id: "org-1",
        nombre: "Taller",
        email: "taller@test.com",
        activo: true,
      }),
    })

    await POST(createPostRequest({ organizationId: "org-999" }) as never)

    expect(vi.mocked(createSubscription)).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1" })
    )
  })
})
