// @vitest-environment node
/**
 * PUT /api/ordenes/[id]: the commission rate, the worked hours and the technician
 * assignment follow the role rules of the order screen. The rate and the hours belong to the
 * ADMIN; assigning belongs to the ADMIN or to someone of the branch that handles the order
 * (the same rule GET reports as `puedeAsignarTecnico`). The technician takes orders through
 * /tomar, not through this endpoint.
 */
import { describe, it, expect, vi } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"
import { tablaPostgrest } from "../helpers/postgrest-memoria"
import { puedeAsignarTecnicoOrden } from "@/lib/sucursal-ordenes"

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({ update: vi.fn().mockResolvedValue(undefined) })),
  diffObjects: vi.fn().mockReturnValue({ before: {}, after: {} }),
}))
vi.mock("@/lib/notifications/queue", () => ({ queueNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/webhooks/dispatcher", () => ({ emitWebhookEvent: vi.fn().mockResolvedValue(undefined) }))

import { PUT } from "@/app/api/ordenes/[id]/route"

const tecnico = (id: string, porcentaje: number, costoHora: number) => ({
  id, nombre: id, rol: "TECNICO", sucursal_id: "suc-A", organization_id: "org-1", deleted_at: null,
  porcentaje_comision: porcentaje, costo_hora: costoHora,
})
const PERSONAL = [tecnico("t-a", 10, 100), tecnico("t-a2", 15, 150)]

function montar(role: string, userId: string, sucursalId: string | null = "suc-A") {
  vi.clearAllMocks()
  mockAuthSuccess({ role, userId, sucursalId })
  const orden = {
    id: "o1", numero_orden: 1, cliente_id: "c1", organization_id: "org-1", sucursal_id: "suc-A",
    tecnico_id: "t-a", estado: "EN_REPARACION", porcentaje_comision: 5, costo_hora_snapshot: 50,
    clientes: { id: "c1", nombre: "Juan", email: null, telefono: null },
    organizations: { id: "org-1", nombre: "Taller", moneda: "ARS", zona_horaria: "America/Argentina/Buenos_Aires" },
  }
  const ordenes = createChainMock(null)
  ordenes.single = vi.fn().mockResolvedValue({ data: orden, error: null })
  mockSupabaseFrom({ ordenes_servicio: ordenes, users: tablaPostgrest(PERSONAL), orden_eventos: createChainMock(null) } as any)
  return { ordenes }
}

const put = (body: Record<string, unknown>) =>
  PUT(
    new Request("http://localhost:3000/api/ordenes/o1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "o1" }) },
  )

describe("PUT /api/ordenes/[id] - commission rate and hours", () => {
  it.each([
    ["the assigned TECNICO", "TECNICO", "t-a"],
    ["a VENDEDOR of the handling branch", "VENDEDOR", "u-9"],
  ])("%s cannot set porcentajeComision: 403 and no update", async (_caso, role, userId) => {
    const { ordenes } = montar(role, userId)

    const { status, body } = await parseResponse(await put({ porcentajeComision: 90 }))

    expect(status).toBe(403)
    expect(body.error).toMatch(/administrador/i)
    expect(ordenes.update).not.toHaveBeenCalled()
  })

  it("an ADMIN sets porcentajeComision", async () => {
    const { ordenes } = montar("ADMIN", "adm", null)

    const { status } = await parseResponse(await put({ porcentajeComision: 12 }))

    expect(status).toBe(200)
    expect(ordenes.update).toHaveBeenCalledWith(expect.objectContaining({ porcentaje_comision: 12 }))
  })

  it.each([
    ["the assigned TECNICO", "TECNICO", "t-a"],
    ["a VENDEDOR of the handling branch", "VENDEDOR", "u-9"],
  ])("%s cannot set horasTrabajadas: 403 and no update", async (_caso, role, userId) => {
    const { ordenes } = montar(role, userId)

    const { status } = await parseResponse(await put({ horasTrabajadas: 3 }))

    expect(status).toBe(403)
    expect(ordenes.update).not.toHaveBeenCalled()
  })

  it("the assigned TECNICO still sets the final cost when marking the order repaired", async () => {
    const { ordenes } = montar("TECNICO", "t-a")

    const { status } = await parseResponse(await put({ costoFinal: 5000, observaciones: "ok" }))

    expect(status).toBe(200)
    expect(ordenes.update).toHaveBeenCalledWith(expect.objectContaining({ costo_final: 5000 }))
  })
})

describe("PUT /api/ordenes/[id] - technician assignment", () => {
  it("the assigned TECNICO cannot assign another technician: 403 and no update", async () => {
    const { ordenes } = montar("TECNICO", "t-a")

    const { status, body } = await parseResponse(await put({ tecnicoId: "t-a2" }))

    expect(status).toBe(403)
    expect(body.error).toMatch(/asignar/i)
    expect(ordenes.update).not.toHaveBeenCalled()
  })

  it("the assigned TECNICO cannot unassign: 403 and no update", async () => {
    const { ordenes } = montar("TECNICO", "t-a")

    expect((await parseResponse(await put({ tecnicoId: null }))).status).toBe(403)
    expect(ordenes.update).not.toHaveBeenCalled()
  })

  it("a VENDEDOR of the handling branch reassigns and the rate is snapshotted", async () => {
    const { ordenes } = montar("VENDEDOR", "u-9")

    const { status } = await parseResponse(await put({ tecnicoId: "t-a2" }))

    expect(status).toBe(200)
    expect(ordenes.update).toHaveBeenCalledWith(
      expect.objectContaining({ tecnico_id: "t-a2", porcentaje_comision: 15, costo_hora_snapshot: 150 }),
    )
  })

  it.each([
    ["the assigned TECNICO", "TECNICO", "t-a", "suc-A"],
    ["a VENDEDOR of the handling branch", "VENDEDOR", "u-9", "suc-A"],
  ])("%s resending the SAME technician is a no-op for the assignment", async (_caso, role, userId, sucursalId) => {
    const { ordenes } = montar(role, userId, sucursalId)

    const { status } = await parseResponse(await put({ tecnicoId: "t-a", observaciones: "x" }))

    expect(status).toBe(200)
    const cambios = ordenes.update.mock.calls[0][0]
    expect(cambios).toEqual(expect.objectContaining({ observaciones: "x" }))
    expect(cambios).not.toHaveProperty("porcentaje_comision")
    expect(cambios).not.toHaveProperty("costo_hora_snapshot")
  })

  it("an ADMIN resending the same technician does not re-snapshot the rate either", async () => {
    const { ordenes } = montar("ADMIN", "adm", null)

    await parseResponse(await put({ tecnicoId: "t-a", observaciones: "x" }))

    const cambios = ordenes.update.mock.calls[0][0]
    expect(cambios).not.toHaveProperty("porcentaje_comision")
    expect(cambios).not.toHaveProperty("costo_hora_snapshot")
  })

  it("an ADMIN reassigning snapshots the new technician rate", async () => {
    const { ordenes } = montar("ADMIN", "adm", null)

    await parseResponse(await put({ tecnicoId: "t-a2" }))

    expect(ordenes.update).toHaveBeenCalledWith(
      expect.objectContaining({ tecnico_id: "t-a2", porcentaje_comision: 15, costo_hora_snapshot: 150 }),
    )
  })
})

describe("puedeAsignarTecnicoOrden", () => {
  const orden = { sucursal_id: "suc-A" }
  it.each([
    ["ADMIN", "ADMIN", null, true],
    ["VENDEDOR of the branch", "VENDEDOR", "suc-A", true],
    ["VENDEDOR of another branch", "VENDEDOR", "suc-B", false],
    ["VENDEDOR without branch", "VENDEDOR", null, false],
    ["TECNICO of the branch", "TECNICO", "suc-A", false],
  ])("%s", (_c, role, sucursalId, esperado) => {
    expect(puedeAsignarTecnicoOrden(role, sucursalId, orden)).toBe(esperado)
  })
})
