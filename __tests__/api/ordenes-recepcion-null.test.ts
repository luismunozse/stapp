/**
 * Regresión: el alta clásica de órdenes NO debe escribir `recepcion_id`.
 *
 * La recepción múltiple agrega `ordenes_servicio.recepcion_id` como columna
 * nullable. Este test fija el contrato de que el flujo de siempre la deja
 * intacta, para que ningún taller que recibe un equipo por vez cambie de
 * comportamiento.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  createGetRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/plan-limits", () => ({
  enforcePlanLimit: vi.fn().mockResolvedValue(null),
  isPlanLimitError: vi.fn().mockReturnValue(false),
  planLimitErrorResponse: vi.fn(),
}))
vi.mock("@/lib/counters", () => ({
  getNextOrderNumberByType: vi.fn().mockResolvedValue({ codigo: "CEL001", numero: 1 }),
}))
vi.mock("@/lib/operadores", () => ({
  resolveOperador: vi.fn().mockResolvedValue("user-1"),
}))
vi.mock("@/lib/sucursal", () => ({
  sucursalParaEscritura: vi.fn().mockResolvedValue("suc-1"),
  sucursalParaLectura: vi.fn().mockResolvedValue({ verTodas: true, sucursalId: null }),
}))
vi.mock("@/lib/notifications/queue", () => ({
  queueNotification: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/audit", () => ({
  createAuditLogger: () => ({ create: vi.fn().mockResolvedValue(undefined) }),
}))
vi.mock("@/lib/tipos-dispositivo-config", () => ({
  tipoValidaImei: vi.fn().mockResolvedValue(false),
}))
// La generación real de PDF (pdf-lib + fontkit) es costosa y no aporta nada
// a esta prueba: lo que se fija acá es que /pdf no consulta `recepciones`
// cuando `recepcion_id` es null, no el contenido del PDF.
vi.mock("@/lib/pdf", () => ({
  generateOrdenPDF: vi.fn().mockResolvedValue(Buffer.from("fake-pdf")),
}))

import { POST } from "@/app/api/ordenes/route"
import { generateOrdenPDF } from "@/lib/pdf"
import { GET as GET_PDF } from "@/app/api/ordenes/[id]/pdf/route"

const validBody = {
  clienteId: "cli-1",
  dispositivo: "iPhone 13",
  tipoDispositivo: "CELULAR",
  problemaReportado: "No enciende",
}

const ordenCreada = {
  id: "ord-1",
  numero_orden: 1,
  codigo_orden: "CEL001",
  cliente_id: "cli-1",
  organization_id: "org-1",
  dispositivo: "iPhone 13",
  tipo_dispositivo: "CELULAR",
  estado: "RECIBIDO",
  public_token: "tok-1",
  sucursal_id: "suc-1",
  clientes: { id: "cli-1", nombre: "Juan", email: null, telefono: "1122334455" },
}

describe("POST /api/ordenes — regresión recepcion_id", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it("no incluye recepcion_id en el insert", async () => {
    const ordenesChain = createChainMock(ordenCreada, null)
    mockSupabaseFrom({
      ordenes_servicio: ordenesChain,
      organizations: createChainMock({ nombre: "Taller", slug: "taller" }, null),
      orden_eventos: createChainMock(null, null),
    })

    const res = await POST(createPostRequest(validBody))
    const { status } = await parseResponse(res)

    expect(status).toBe(201)
    expect(ordenesChain.insert).toHaveBeenCalledTimes(1)

    const payload = ordenesChain.insert.mock.calls[0][0] as Record<string, unknown>
    expect("recepcion_id" in payload).toBe(false)
  })

  it("crea la orden en estado RECIBIDO sin lote asociado", async () => {
    const ordenesChain = createChainMock(ordenCreada, null)
    mockSupabaseFrom({
      ordenes_servicio: ordenesChain,
      organizations: createChainMock({ nombre: "Taller", slug: "taller" }, null),
      orden_eventos: createChainMock(null, null),
    })

    await POST(createPostRequest(validBody))

    const payload = ordenesChain.insert.mock.calls[0][0] as Record<string, unknown>
    expect(payload.estado).toBe("RECIBIDO")
  })
})

describe("GET /api/ordenes/[id]/pdf — sin lote no consulta recepciones", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it("no toca la tabla recepciones cuando recepcion_id es null", async () => {
    const recepcionesChain = createChainMock(null, null)
    mockSupabaseFrom({
      ordenes_servicio: createChainMock({ ...ordenCreada, recepcion_id: null }, null),
      checklist_recepcion: createChainMock(null, null),
      fotos_orden: createChainMock([], null),
      organizations: createChainMock({ nombre: "Taller", terminologia: null }, null),
      recepciones: recepcionesChain,
    })

    const res = await GET_PDF(createGetRequest(), { params: Promise.resolve({ id: "ord-1" }) })

    expect(res.status).toBe(200)
    expect(recepcionesChain.select).not.toHaveBeenCalled()
  })

  // Contracara del test de arriba: con lote, la firma UNICA del comprobante
  // tiene que terminar en el payload del PDF de cada orden del lote. Es la
  // unica firma que existe para esas ordenes (la recepcion multiple no crea
  // checklist_recepcion por equipo), asi que si esto se rompe el PDF sale sin
  // firma y el comprobante deja de probar la conformidad del cliente.
  it("resuelve la firma del lote hacia el PDF cuando recepcion_id esta seteado", async () => {
    const recepcionesChain = createChainMock({ firma_cliente: "data:image/png;base64,FIRMALOTE" }, null)
    mockSupabaseFrom({
      ordenes_servicio: createChainMock({ ...ordenCreada, recepcion_id: "rec-1" }, null),
      checklist_recepcion: createChainMock(null, null),
      fotos_orden: createChainMock([], null),
      organizations: createChainMock({ nombre: "Taller", terminologia: null }, null),
      recepciones: recepcionesChain,
    })

    const res = await GET_PDF(createGetRequest(), { params: Promise.resolve({ id: "ord-1" }) })

    expect(res.status).toBe(200)
    expect(recepcionesChain.select).toHaveBeenCalledWith("firma_cliente")
    expect(recepcionesChain.eq).toHaveBeenCalledWith("id", "rec-1")

    const pdfData = vi.mocked(generateOrdenPDF).mock.calls[0][0]
    expect(pdfData.firmaRecepcion).toBe("data:image/png;base64,FIRMALOTE")
  })
})
