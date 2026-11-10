import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"
import { createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"

vi.mock("@/lib/superadmin-auth", () => ({
  requireSuperadmin: vi.fn().mockResolvedValue({ error: null, email: "admin@stapp.com.ar" }),
}))
vi.mock("@/lib/superadmin-audit", () => ({
  createSuperadminAuditLogger: vi.fn(() => ({ log: vi.fn().mockResolvedValue(undefined) })),
}))

import { requireSuperadmin } from "@/lib/superadmin-auth"
import { GET, POST } from "@/app/api/superadmin/organizations/[id]/facturacion-delegada/route"

const params = { params: Promise.resolve({ id: "org-1" }) }
const post = (body: unknown) =>
  new Request("http://localhost/api/superadmin/organizations/org-1/facturacion-delegada", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

const FILA = {
  provider: "arca_delegado",
  cuit: "30710955057",
  estado: "pendiente_verificacion",
  punto_venta: 2,
  condicion_fiscal: "MONOTRIBUTO",
  updated_at: "2026-11-10T12:00:00Z",
}

/** select previo devuelve `fila`; el update devuelve `actualizada`. */
function mockCredenciales(fila: any, actualizada: any = { ...fila }) {
  const updateChain = createChainMock(actualizada, null)
  const cred: any = createChainMock(fila, null)
  cred.update = vi.fn().mockReturnValue(updateChain)
  mockSupabaseFrom({ facturacion_credenciales: cred })
  return { cred, updateChain }
}

describe("superadmin — verificación de la delegación ARCA", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireSuperadmin).mockResolvedValue({ error: null, email: "admin@stapp.com.ar" } as any)
  })

  it("GET devuelve la delegación de la organización", async () => {
    mockCredenciales(FILA)

    const { status, body } = await parseResponse(await GET(new Request("http://x"), params))

    expect(status).toBe(200)
    expect(body.delegacion).toMatchObject({ cuit: "30710955057", estado: "pendiente_verificacion", puntoVenta: 2 })
  })

  it("GET devuelve null si la organización no factura por delegación", async () => {
    mockCredenciales({ ...FILA, provider: "arca" })

    const { body } = await parseResponse(await GET(new Request("http://x"), params))

    expect(body.delegacion).toBeNull()
  })

  it("aprobar pasa una delegación pendiente a 'conectado'", async () => {
    const { cred, updateChain } = mockCredenciales(FILA, { ...FILA, estado: "conectado" })

    const { status, body } = await parseResponse(await POST(post({ accion: "aprobar" }), params))

    expect(status).toBe(200)
    expect(cred.update).toHaveBeenCalledWith(expect.objectContaining({ estado: "conectado" }))
    expect(updateChain.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(updateChain.eq).toHaveBeenCalledWith("provider", "arca_delegado")
    expect(updateChain.eq).toHaveBeenCalledWith("cuit", "30710955057")
    expect(body.delegacion.estado).toBe("conectado")
  })

  it("rechazar deja la delegación en 'error'", async () => {
    const { cred } = mockCredenciales({ ...FILA, estado: "conectado" }, { ...FILA, estado: "error" })

    const { status } = await parseResponse(await POST(post({ accion: "rechazar" }), params))

    expect(status).toBe(200)
    expect(cred.update).toHaveBeenCalledWith(expect.objectContaining({ estado: "error" }))
  })

  it("409 si la delegación cambió de CUIT mientras se revisaba (el update no matchea)", async () => {
    mockCredenciales(FILA, null)

    const { status } = await parseResponse(await POST(post({ accion: "aprobar" }), params))

    expect(status).toBe(409)
  })

  it("404 si la organización no tiene delegación", async () => {
    const { cred } = mockCredenciales(null)

    const { status } = await parseResponse(await POST(post({ accion: "aprobar" }), params))

    expect(status).toBe(404)
    expect(cred.update).not.toHaveBeenCalled()
  })

  it("400 con una acción desconocida", async () => {
    const { cred } = mockCredenciales(FILA)

    const { status } = await parseResponse(await POST(post({ accion: "borrar" }), params))

    expect(status).toBe(400)
    expect(cred.update).not.toHaveBeenCalled()
  })

  it("sin superadmin no lee ni escribe", async () => {
    vi.mocked(requireSuperadmin).mockResolvedValue({
      error: NextResponse.json({ error: "No autorizado" }, { status: 403 }),
    } as any)
    const { cred } = mockCredenciales(FILA)

    const { status } = await parseResponse(await POST(post({ accion: "aprobar" }), params))

    expect(status).toBe(403)
    expect(cred.update).not.toHaveBeenCalled()
  })
})
