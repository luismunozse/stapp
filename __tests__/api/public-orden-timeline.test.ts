import { describe, it, expect, vi, beforeEach } from "vitest"
import { createChainMock, mockSupabaseFrom, createGetRequest, parseResponse } from "./helpers"

vi.mock("@/lib/public-token", () => ({
  getOrderByPublicToken: vi.fn(),
}))
vi.mock("@/lib/storage-privado", () => ({
  firmarCampo: vi.fn(async (_bucket: string, filas: Record<string, unknown>[]) =>
    filas.map((f) => ({ ...f, url: `https://firmada/${f.storage_path}` }))
  ),
}))

import { getOrderByPublicToken } from "@/lib/public-token"
import { GET } from "@/app/api/public/ordenes/[token]/timeline/route"

function createParams(token: string) {
  return { params: Promise.resolve({ token }) }
}

const eventosDb = [
  {
    id: "e1", tipo: "CAMBIO_ESTADO", estado_anterior: null, estado_nuevo: "RECIBIDO",
    descripcion: "Orden creada en la recepcion REC-0042", metadata: { interno: true },
    created_at: "2026-11-01T10:00:00Z", users: { nombre: "Empleado Interno" },
  },
  {
    id: "e2", tipo: "NOTA", estado_anterior: null, estado_nuevo: null,
    descripcion: "Cliente complicado, cobrarle por adelantado", metadata: {},
    created_at: "2026-11-01T11:00:00Z", users: { nombre: "Empleado Interno" },
  },
  {
    id: "e3", tipo: "REPUESTO_AGREGADO", estado_anterior: null, estado_nuevo: null,
    descripcion: "Repuesto con costo 1200", metadata: { costo: 1200 },
    created_at: "2026-11-01T12:00:00Z", users: null,
  },
  {
    id: "e4", tipo: "PRESUPUESTO_APROBADO", estado_anterior: "PRESUPUESTADO", estado_nuevo: "APROBADO",
    descripcion: "Presupuesto aprobado por el cliente via WhatsApp", metadata: { canal: "wa" },
    created_at: "2026-11-02T10:00:00Z", users: null,
  },
  {
    id: "e5", tipo: "CAMBIO_ESTADO", estado_anterior: "APROBADO", estado_nuevo: "SIN_FALLA_DETECTADA",
    descripcion: "Estado cambiado de APROBADO a SIN_FALLA_DETECTADA", metadata: {},
    created_at: "2026-11-03T10:00:00Z", users: { nombre: "Empleado Interno" },
  },
]

const fotosDb = [
  { id: "f1", url: "x", storage_path: "org/f1.jpg", tipo: "INGRESO", descripcion: "Frente", created_at: "2026-11-01T10:30:00Z" },
  { id: "f2", url: "x", storage_path: "org/f2.jpg", tipo: "DIAGNOSTICO", descripcion: "Placa", created_at: "2026-11-01T10:40:00Z" },
  { id: "f3", url: "x", storage_path: "org/f3.jpg", tipo: "COMPONENTE", descripcion: null, created_at: "2026-11-01T10:50:00Z" },
]

describe("GET /api/public/ordenes/[token]/timeline", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getOrderByPublicToken).mockResolvedValue({ orden: { id: "o1" }, error: null } as any)
  })

  it("devuelve sólo eventos públicos, sin metadata, descripcion interna ni empleado", async () => {
    const eventos = createChainMock(eventosDb)
    const fotos = createChainMock(fotosDb)
    mockSupabaseFrom({ orden_eventos: eventos, fotos_orden: fotos })

    const res = await GET(createGetRequest(), createParams("tok"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(Array.isArray(body.timeline)).toBe(true)

    // Lista blanca también en el query
    expect(eventos.in).toHaveBeenCalledWith("tipo", [
      "CAMBIO_ESTADO", "PRESUPUESTO_DEFINIDO", "PRESUPUESTO_APROBADO", "PRESUPUESTO_RECHAZADO",
    ])
    expect(eventos.select).toHaveBeenCalledWith(expect.not.stringContaining("metadata"))
    expect(eventos.select).toHaveBeenCalledWith(expect.not.stringContaining("created_by"))

    const eventosOut = body.timeline.filter((e: any) => e.type === "evento")
    expect(eventosOut.map((e: any) => e.id)).toEqual(["e1", "e4", "e5"])
    expect(eventosOut.map((e: any) => e.eventType)).not.toContain("NOTA")
    for (const e of body.timeline) {
      expect(e).not.toHaveProperty("metadata")
      expect(e).not.toHaveProperty("createdBy")
    }
    for (const e of eventosOut) {
      expect(e).not.toHaveProperty("descripcion")
    }

    const raw = JSON.stringify(body)
    expect(raw).not.toContain("Empleado Interno")
    expect(raw).not.toContain("cobrarle por adelantado")
    expect(raw).not.toContain("REC-0042")
    expect(raw).not.toContain("storage_path")
  })

  it("expone sólo las fotos que ya publica /photos (INGRESO, REPARACION, ENTREGA)", async () => {
    const fotos = createChainMock(fotosDb)
    mockSupabaseFrom({ orden_eventos: createChainMock([]), fotos_orden: fotos })

    const res = await GET(createGetRequest(), createParams("tok"))
    const { body } = await parseResponse(res)

    expect(fotos.in).toHaveBeenCalledWith("tipo", ["INGRESO", "REPARACION", "ENTREGA"])
    const fotosOut = body.timeline.filter((e: any) => e.type === "foto")
    expect(fotosOut).toEqual([
      {
        id: "f1", type: "foto", eventType: "FOTO_AGREGADA", url: "https://firmada/org/f1.jpg",
        fotoTipo: "INGRESO", descripcion: "Frente", createdAt: "2026-11-01T10:30:00Z",
      },
    ])
  })

  it("propaga el error del token sin consultar eventos", async () => {
    const { NextResponse } = await import("next/server")
    vi.mocked(getOrderByPublicToken).mockResolvedValue({
      orden: null,
      error: NextResponse.json({ error: "Orden no encontrada" }, { status: 404 }),
    } as any)
    const eventos = createChainMock(eventosDb)
    mockSupabaseFrom({ orden_eventos: eventos })

    const res = await GET(createGetRequest(), createParams("nope"))
    expect(res.status).toBe(404)
    expect(eventos.select).not.toHaveBeenCalled()
  })
})
