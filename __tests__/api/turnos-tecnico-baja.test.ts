/**
 * A removed technician (users.deleted_at set) cannot be booked on a turno:
 * the tecnicoId lookup must exclude removed users, so they are rejected like
 * an unknown one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, createPostRequest, parseResponse } from "./helpers"

vi.mock("@/lib/plan-limits", () => ({
  enforcePlanLimit: vi.fn().mockResolvedValue(null),
  isPlanLimitError: vi.fn().mockReturnValue(false),
  planLimitErrorResponse: vi.fn(),
}))
vi.mock("@/lib/turnos/notifications", () => ({
  notifyTurno: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/sucursal", () => ({
  sucursalParaEscritura: vi.fn().mockResolvedValue("suc-A"),
  sucursalParaLectura: vi.fn().mockResolvedValue({ verTodas: true, sucursalId: null }),
}))

import { POST } from "@/app/api/turnos/route"
import { PATCH } from "@/app/api/turnos/[id]/route"

describe("booking a turno with a removed technician", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
  })

  it("POST /api/turnos rejects it like an unknown technician", async () => {
    const users = createChainMock(null)
    const organizations = createChainMock({ modulo_agenda: true, zona_horaria: "UTC" })
    mockSupabaseFrom({ users, organizations })
    const res = await POST(
      createPostRequest({
        clienteId: "c1",
        tipo: "visita_diagnostico",
        inicio: "2030-01-01T10:00:00.000Z",
        fin: "2030-01-01T11:00:00.000Z",
        tecnicoId: "t-baja",
      })
    )
    const { status, body } = await parseResponse(res)
    expect(status).toBe(400)
    expect(body.error).toBe("Técnico inválido")
    expect(users.is).toHaveBeenCalledWith("deleted_at", null)
  })

  it("PATCH /api/turnos/[id] rejects reassigning to a removed technician", async () => {
    const users = createChainMock(null)
    const turnos = createChainMock({
      id: "tu1",
      estado: "agendado",
      tecnico_id: "t1",
      inicio: "2030-01-01T10:00:00.000Z",
      fin: "2030-01-01T11:00:00.000Z",
      organization_id: "org-1",
    })
    mockSupabaseFrom({ users, turnos })
    const res = await PATCH(
      new Request("http://localhost:3000/api/turnos/tu1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tecnicoId: "t-baja" }),
      }),
      { params: Promise.resolve({ id: "tu1" }) }
    )
    const { status, body } = await parseResponse(res)
    expect(status).toBe(400)
    expect(body.error).toBe("Técnico inválido")
    expect(users.is).toHaveBeenCalledWith("deleted_at", null)
  })
})
