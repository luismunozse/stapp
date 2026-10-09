/**
 * Las dos rutas de PDF de la orden (autenticada y publica por token) tienen
 * que pasarle a generateOrdenPDF el trabajo a realizar de la orden y los dias
 * de garantia de la organizacion. generateOrdenPDF va mockeado: se fija el
 * contrato de datos, no el dibujo (eso lo cubre orden-pdf-trabajo-garantia).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, createGetRequest } from "./helpers"

vi.mock("@/lib/pdf", () => ({
  generateOrdenPDF: vi.fn().mockResolvedValue(Buffer.from("fake-pdf")),
}))
vi.mock("@/lib/terminologia-server", () => ({
  getTerminologia: vi.fn().mockResolvedValue(null),
}))

import { GET as GET_PDF } from "@/app/api/ordenes/[id]/pdf/route"
import { GET as GET_PUBLIC_PDF } from "@/app/api/public/ordenes/[token]/pdf/route"
import { generateOrdenPDF } from "@/lib/pdf"

function orden(overrides: Record<string, unknown> = {}, org: Record<string, unknown> = {}) {
  return {
    id: "ord-1",
    numero_orden: 1,
    codigo_orden: "CEL001",
    organization_id: "org-1",
    cliente_id: "cli-1",
    dispositivo: "iPhone 13",
    tipo_dispositivo: "CELULAR",
    problema_reportado: "No enciende",
    fecha_ingreso: "2026-01-01T00:00:00.000Z",
    estado: "RECIBIDO",
    public_token: "a".repeat(32),
    public_token_expires_at: null,
    clientes: { id: "cli-1", nombre: "Juan", email: null, telefono: "1122334455" },
    organizations: { nombre: "Taller", ...org },
    ...overrides,
  }
}

function mockTablas(row: unknown) {
  mockSupabaseFrom({
    ordenes_servicio: createChainMock(row, null),
    checklist_recepcion: createChainMock(null, null),
    fotos_orden: createChainMock([], null),
    orden_tiempos_estado: createChainMock([], null),
  })
}

describe("PDF de la orden - trabajo a realizar y garantia", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it("ruta autenticada: pasa trabajoARealizar y garantiaDiasDefault", async () => {
    mockTablas(orden({ trabajo_a_realizar: "Cambio de pantalla" }, { garantia_dias_default: 30 }))
    const res = await GET_PDF(createGetRequest(), { params: Promise.resolve({ id: "ord-1" }) })
    expect(res.status).toBe(200)
    const data: any = vi.mocked(generateOrdenPDF).mock.calls[0][0]
    expect(data.trabajoARealizar).toBe("Cambio de pantalla")
    expect(data.garantiaDiasDefault).toBe(30)
  })

  it("ruta autenticada: sin datos llegan null (el PDF omite fila y linea)", async () => {
    mockTablas(orden({}, {}))
    await GET_PDF(createGetRequest(), { params: Promise.resolve({ id: "ord-1" }) })
    const data: any = vi.mocked(generateOrdenPDF).mock.calls[0][0]
    expect(data.trabajoARealizar ?? null).toBeNull()
    expect(data.garantiaDiasDefault ?? null).toBeNull()
  })

  it("ruta publica por token: pasa trabajoARealizar y garantiaDiasDefault", async () => {
    mockTablas(orden({ trabajo_a_realizar: "Cambio de bateria" }, { garantia_dias_default: 90 }))
    const res = await GET_PUBLIC_PDF(createGetRequest(), { params: Promise.resolve({ token: "a".repeat(32) }) })
    expect(res.status).toBe(200)
    const data: any = vi.mocked(generateOrdenPDF).mock.calls[0][0]
    expect(data.trabajoARealizar).toBe("Cambio de bateria")
    expect(data.garantiaDiasDefault).toBe(90)
  })
})
