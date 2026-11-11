import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({ update: vi.fn().mockResolvedValue(undefined) })),
  diffObjects: vi.fn().mockReturnValue({ before: {}, after: {} }),
}))
vi.mock("@/lib/notifications/queue", () => ({ queueNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/webhooks/dispatcher", () => ({ emitWebhookEvent: vi.fn().mockResolvedValue(undefined) }))
const validaImei = vi.hoisted(() => ({ current: false }))
vi.mock("@/lib/tipos-dispositivo-config", () => ({
  tipoValidaImei: vi.fn(async () => validaImei.current),
}))

import { PUT } from "@/app/api/ordenes/[id]/route"

const ORDEN = {
  id: "o1",
  numero_orden: 1,
  codigo_orden: "CEL-001",
  cliente_id: "c1",
  tecnico_id: "t1",
  organization_id: "org-1",
  tipo_dispositivo: "CELULAR",
  dispositivo: "iPhone 13",
  marca: "Apple",
  color: "Negro",
  imei: null,
  problema_reportado: "Pantalla rota",
  estado: "ENTREGADO",
  costo_final: "25000",
  clientes: { id: "c1", nombre: "Juan", email: "j@test.com", telefono: "123" },
  organizations: { id: "org-1", nombre: "Taller", moneda: "ARS", zona_horaria: "America/Argentina/Buenos_Aires" },
}

const put = (body: unknown) =>
  PUT(
    new Request("http://localhost:3000/api/ordenes/o1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "o1" }) }
  )

function mockOrden() {
  let calls = 0
  const chain = createChainMock(null)
  chain.single = vi.fn().mockImplementation(() =>
    Promise.resolve({ data: ++calls === 1 ? ORDEN : { ...ORDEN }, error: null })
  )
  mockSupabaseFrom({ ordenes_servicio: chain })
  return chain
}

describe("PUT /api/ordenes/[id] - datos del equipo", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    validaImei.current = false
    mockAuthSuccess()
  })

  it("guarda los datos del equipo, incluso en una orden entregada; los textos vacíos quedan en null", async () => {
    const chain = mockOrden()
    const res = await put({
      dispositivo: "iPhone 14",
      marca: " ",
      color: "",
      imei: " ABC123 ",
      codigoAccesoDispositivo: "Patrón: 1-2-3",
      accesorios: "Cargador, funda",
      telefonoContacto: "  ",
      metadata: { capacidad: "128GB" },
    })

    expect((await parseResponse(res)).status).toBe(200)
    expect(chain.update.mock.calls[0][0]).toMatchObject({
      dispositivo: "iPhone 14",
      marca: null,
      color: null,
      imei: "ABC123",
      password_dispositivo: "Patrón: 1-2-3",
      accesorios: "Cargador, funda",
      telefono_contacto: null,
      metadata: { capacidad: "128GB" },
    })
  })

  it("no acepta dejar el modelo vacío", async () => {
    const chain = mockOrden()
    const res = await put({ dispositivo: "  " })
    expect((await parseResponse(res)).status).toBe(400)
    expect(chain.update).not.toHaveBeenCalled()
  })

  it("si el tipo valida IMEI, rechaza uno que no tiene 15 dígitos", async () => {
    validaImei.current = true
    const chain = mockOrden()
    const res = await put({ imei: "1234" })
    const { status, body } = await parseResponse(res)
    expect(status).toBe(400)
    expect(body.error).toMatch(/15 dígitos/)
    expect(chain.update).not.toHaveBeenCalled()
  })

  it("si el tipo valida IMEI, acepta uno de 15 dígitos", async () => {
    validaImei.current = true
    const chain = mockOrden()
    const res = await put({ imei: "490154203237518" })
    expect((await parseResponse(res)).status).toBe(200)
    expect(chain.update.mock.calls[0][0]).toMatchObject({ imei: "490154203237518" })
  })

  it("no toca los datos del equipo que no se mandan", async () => {
    const chain = mockOrden()
    await put({ notasInternas: "x" })
    const update = chain.update.mock.calls[0][0]
    for (const col of ["dispositivo", "marca", "color", "imei", "password_dispositivo", "accesorios", "metadata"]) {
      expect(update).not.toHaveProperty(col)
    }
  })
})
