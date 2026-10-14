import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockAuthError, createGetRequest, parseResponse } from "./helpers"

vi.mock("@/lib/notas-credito/documento", async () => {
  const real = await vi.importActual<typeof import("@/lib/notas-credito/documento")>("@/lib/notas-credito/documento")
  return { ...real, cargarDocumentoNC: vi.fn() }
})

import { cargarDocumentoNC } from "@/lib/notas-credito/documento"
import { GET } from "@/app/api/notas-credito/[id]/route"

const params = (id: string) => ({ params: Promise.resolve({ id }) })
const get = (id = "nc-1") => GET(createGetRequest(`http://localhost/api/notas-credito/${id}`), params(id))

describe("GET /api/notas-credito/[id]", () => {
  beforeEach(() => vi.clearAllMocks())

  it("sin sesión responde 401 y no carga nada", async () => {
    mockAuthError()
    expect((await get()).status).toBe(401)
    expect(cargarDocumentoNC).not.toHaveBeenCalled()
  })

  it("le pasa al cargador quién mira: organización, usuario, rol y sucursal", async () => {
    mockAuthSuccess({ role: "VENDEDOR", userId: "user-7", sucursalId: "suc-3" })
    vi.mocked(cargarDocumentoNC).mockResolvedValue({ id: "nc-1" } as any)
    await get("nc-1")
    expect(cargarDocumentoNC).toHaveBeenCalledWith("nc-1", {
      organizationId: "org-1", userId: "user-7", role: "VENDEDOR", userSucursalId: "suc-3",
    })
  })

  it("lo que el cargador no devuelve es 404, sin distinguir ajena de inexistente", async () => {
    mockAuthSuccess({ role: "TECNICO" })
    vi.mocked(cargarDocumentoNC).mockResolvedValue(null)
    const res = await parseResponse(await get())
    expect(res.status).toBe(404)
    expect(res.body.error).toBe("Nota de crédito no encontrada")
  })

  it("devuelve el documento sin cache", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(cargarDocumentoNC).mockResolvedValue({ id: "nc-1", numero: "NC-000001" } as any)
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    expect(await res.json()).toEqual({ id: "nc-1", numero: "NC-000001" })
  })

  it("un error del cargador es 500", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(cargarDocumentoNC).mockRejectedValue(new Error("boom"))
    expect((await get()).status).toBe(500)
  })
})
