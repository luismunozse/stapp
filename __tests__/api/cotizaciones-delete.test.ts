import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({
    delete: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
  })),
  diffObjects: vi.fn().mockReturnValue({ before: {}, after: {} }),
}))

import { DELETE } from "@/app/api/cotizaciones/[id]/route"

function createDeleteRequest() {
  return new Request("http://localhost:3000/api/cotizaciones/cot1", { method: "DELETE" })
}
function createParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

// cotizaciones: .single() devuelve la cotización objetivo; awaitar la cadena
// (conteo de otras / remaining) devuelve `otras`.
function cotChainMock(cotizacion: any, otras: any[]) {
  const chain = createChainMock(otras)
  chain.single = vi.fn().mockResolvedValue({ data: cotizacion, error: null })
  return chain
}

// ordenes_servicio: .single() devuelve el estado; awaitar el UPDATE atómico
// (.select("id")) devuelve las filas afectadas.
function ordChainMock(estado: string, filasAfectadas: any[]) {
  const chain = createChainMock(filasAfectadas)
  chain.single = vi.fn().mockResolvedValue({ data: { id: "o1", estado }, error: null })
  return chain
}

describe("DELETE /api/cotizaciones/[id] — bug #6a (bloqueo en APROBADO)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("bloquea (400) borrar la última cotización de una orden APROBADA y no la borra", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const cot = { id: "cot1", estado: "ENVIADA", organization_id: "org-1", orden_id: "o1" }
    const cotizaciones = cotChainMock(cot, []) // 0 otras activas → sería la última
    const ordenes = ordChainMock("APROBADO", [])
    mockSupabaseFrom({ cotizaciones, ordenes_servicio: ordenes })

    const res = await DELETE(createDeleteRequest(), createParams("cot1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toContain("orden aprobada")
    // No debe soft-deletear (no llamó al UPDATE de cotizaciones)
    expect(cotizaciones.update).not.toHaveBeenCalled()
  })

  it("permite borrar la última cotización de una orden PRESUPUESTADA y la revierte a EN_DIAGNOSTICO", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const cot = { id: "cot1", estado: "ENVIADA", organization_id: "org-1", orden_id: "o1" }
    const cotizaciones = cotChainMock(cot, []) // 0 otras/remaining
    const ordenes = ordChainMock("PRESUPUESTADO", [{ id: "o1" }]) // update atómico afecta 1 fila
    const eventos = createChainMock(null)
    mockSupabaseFrom({ cotizaciones, ordenes_servicio: ordenes, orden_eventos: eventos })

    const res = await DELETE(createDeleteRequest(), createParams("cot1"))
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(cotizaciones.update).toHaveBeenCalled() // soft-delete
    expect(ordenes.update).toHaveBeenCalledWith(
      expect.objectContaining({ estado: "EN_DIAGNOSTICO" })
    )
    // Guarda de concurrencia en la reversión.
    expect(ordenes.eq).toHaveBeenCalledWith("estado", "PRESUPUESTADO")
  })
})
