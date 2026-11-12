import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

vi.mock("@/lib/public-token", () => ({ getOrderByPublicToken: vi.fn() }))
vi.mock("@/lib/ordenes/danos-server", () => ({ listarDanosOrden: vi.fn() }))

import { getOrderByPublicToken } from "@/lib/public-token"
import { listarDanosOrden } from "@/lib/ordenes/danos-server"
import { GET } from "@/app/api/public/ordenes/[token]/danos/route"

const params = (token: string) => ({ params: Promise.resolve({ token }) })
const req = () => new Request("http://localhost/api/public/ordenes/x/danos")

describe("GET /api/public/ordenes/[token]/danos", () => {
  beforeEach(() => vi.clearAllMocks())

  it("token inválido: 404 y no consulta daños", async () => {
    vi.mocked(getOrderByPublicToken).mockResolvedValue({
      orden: null,
      error: NextResponse.json({ error: "Orden no encontrada" }, { status: 404 }),
    })
    const res = await GET(req(), params("t".repeat(32)))
    expect(res.status).toBe(404)
    expect(listarDanosOrden).not.toHaveBeenCalled()
  })

  it("no expone autor ni created_by y consulta sin autor", async () => {
    vi.mocked(getOrderByPublicToken).mockResolvedValue({ orden: { id: "o1", organization_id: "org1" }, error: null })
    vi.mocked(listarDanosOrden).mockResolvedValue({
      danos: [
        {
          id: "d1", numero: 1, diagrama: "celular", vista: "frente", x: 0.5, y: 0.5, tipo: "rayon",
          nota: null, momento: "recepcion", createdAt: "2026-11-12T10:00:00Z", createdByNombre: "Empleado Interno",
        },
      ],
      sinDanos: false,
      diagrama: "celular",
    } as any)
    const res = await GET(req(), params("t".repeat(32)))
    expect(res.status).toBe(200)
    expect(listarDanosOrden).toHaveBeenCalledWith("o1", "org1", { incluirAutor: false })
    const texto = JSON.stringify(await res.json())
    expect(texto).not.toContain("createdByNombre")
    expect(texto).not.toContain("created_by")
    expect(texto).not.toContain("Empleado Interno")
    expect(texto).toContain('"numero":1')
  })
})
