/**
 * PUT /api/ordenes/[id] — corrección de los datos del equipo ya cargado.
 *
 * Hasta ahora el schema de update solo aceptaba estado, plata, fechas y los
 * textos de diagnóstico/notas: el dispositivo, la marca, el color, el
 * identificador y los accesorios entraban una sola vez en el alta y después no
 * había forma de tocarlos. Un accesorio que no se marcó en el mostrador salía
 * con un guion en el comprobante y la única salida era dar de baja la orden y
 * cargarla de nuevo (con otro número).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({
    update: vi.fn().mockResolvedValue(undefined),
  })),
  diffObjects: vi.fn().mockReturnValue({ before: {}, after: {} }),
}))

vi.mock("@/lib/notifications/queue", () => ({
  queueNotification: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/webhooks/dispatcher", () => ({
  emitWebhookEvent: vi.fn().mockResolvedValue(undefined),
}))

const tipoValidaImeiMock = vi.fn().mockResolvedValue(false)
vi.mock("@/lib/tipos-dispositivo-config", () => ({
  tipoValidaImei: (...args: unknown[]) => tipoValidaImeiMock(...args),
}))

import { PUT } from "@/app/api/ordenes/[id]/route"

function createPutRequest(body: any) {
  return new Request("http://localhost:3000/api/ordenes/o1", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

const params = { params: Promise.resolve({ id: "o1" }) }

function mockOrdenServicio(overrides: Record<string, any> = {}) {
  const orden = {
    id: "o1",
    numero_orden: 23,
    codigo_orden: "PC023",
    cliente_id: "c1",
    tecnico_id: "t1",
    organization_id: "org-1",
    tipo_dispositivo: "COMPUTADORA",
    dispositivo: "HP 240 G7",
    marca: null,
    color: null,
    imei: null,
    accesorios: null,
    password_dispositivo: null,
    problema_reportado: "Cambio a SSD",
    estado: "RECIBIDO",
    presupuesto: null,
    costo_final: null,
    fecha_ingreso: "2024-01-01",
    fecha_prometida: null,
    fecha_completado: null,
    clientes: { id: "c1", nombre: "Candela", email: null, telefono: "3544612046" },
    organizations: { id: "org-1", nombre: "AS Tecno", moneda: "ARS", zona_horaria: "America/Argentina/Buenos_Aires" },
    ...overrides,
  }

  let callCount = 0
  const chain = createChainMock(null)
  chain.single = vi.fn().mockImplementation(() => {
    callCount++
    if (callCount === 1) return Promise.resolve({ data: orden, error: null })
    return Promise.resolve({ data: { ...orden }, error: null })
  })
  mockSupabaseFrom({ ordenes_servicio: chain, orden_eventos: createChainMock(null) })
  return chain
}

describe("PUT /api/ordenes/[id] — datos del equipo", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tipoValidaImeiMock.mockResolvedValue(false)
  })

  it("guarda los accesorios que faltaban en el alta", async () => {
    mockAuthSuccess()
    const chain = mockOrdenServicio()

    const response = await PUT(createPutRequest({ accesorios: "Cargador" }), params)
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ accesorios: "Cargador" })
    )
  })

  it("vaciar un campo del equipo lo deja en null, no en string vacio", async () => {
    mockAuthSuccess()
    const chain = mockOrdenServicio({ accesorios: "Cargador", marca: "HP" })

    const response = await PUT(createPutRequest({ accesorios: "  ", marca: "" }), params)
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ accesorios: null, marca: null })
    )
  })

  it("corrige modelo, color e identificador del equipo", async () => {
    mockAuthSuccess()
    const chain = mockOrdenServicio()

    const response = await PUT(
      createPutRequest({
        dispositivo: "  HP 240 G7 Notebook  ",
        color: "Gris",
        imei: "5CD1234ABC",
        codigoAccesoDispositivo: "1234",
      }),
      params
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        dispositivo: "HP 240 G7 Notebook",
        color: "Gris",
        imei: "5CD1234ABC",
        password_dispositivo: "1234",
      })
    )
  })

  it("rechaza un dispositivo vacio (es el nombre del equipo en el comprobante)", async () => {
    mockAuthSuccess()
    const chain = mockOrdenServicio()

    const response = await PUT(createPutRequest({ dispositivo: "" }), params)
    const { status } = await parseResponse(response)

    expect(status).toBe(400)
    expect(chain.update).not.toHaveBeenCalled()
  })

  it("valida el identificador con la misma regla del alta cuando el tipo pide IMEI", async () => {
    mockAuthSuccess()
    tipoValidaImeiMock.mockResolvedValue(true)
    const chain = mockOrdenServicio({ tipo_dispositivo: "CELULAR" })

    const response = await PUT(createPutRequest({ imei: "123" }), params)
    const { status, body } = await parseResponse(response)

    expect(status).toBe(400)
    expect(body.error).toContain("15")
    expect(chain.update).not.toHaveBeenCalled()
  })

  it("permite borrar el identificador aunque el tipo pida IMEI", async () => {
    mockAuthSuccess()
    tipoValidaImeiMock.mockResolvedValue(true)
    const chain = mockOrdenServicio({ tipo_dispositivo: "CELULAR", imei: "123456789012345" })

    const response = await PUT(createPutRequest({ imei: "" }), params)
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ imei: null }))
  })

  it("no acepta cambiar el tipo de equipo: el codigo de la orden sale de su contador", async () => {
    mockAuthSuccess()
    const chain = mockOrdenServicio()

    const response = await PUT(createPutRequest({ tipoDispositivo: "CELULAR" }), params)
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    // Zod descarta la clave desconocida; lo que importa es que no llegue a la
    // columna y la orden PC023 no termine siendo de otro tipo.
    expect(chain.update).toHaveBeenCalledWith(
      expect.not.objectContaining({ tipo_dispositivo: expect.anything() })
    )
  })
})
