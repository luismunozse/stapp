// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockSupabaseFrom,
  createChainMock,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/operadores", () => ({ resolveOperador: vi.fn() }))

vi.mock("@/lib/plan-limits", () => ({
  enforcePlanLimit: vi.fn().mockResolvedValue(null),
  isPlanLimitError: vi.fn().mockReturnValue(false),
  planLimitErrorResponse: vi.fn(),
}))

vi.mock("@/lib/counters", () => ({
  getNextOrderNumberByType: vi.fn().mockResolvedValue({ codigo: "CEL-001", numero: 1 }),
}))

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({
    create: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock("@/lib/storage", () => ({
  uploadOrderPhoto: vi.fn().mockResolvedValue({ url: "http://example.com/photo.jpg", path: "photos/1.jpg" }),
  base64ToBuffer: vi.fn().mockReturnValue(Buffer.from("fake")),
}))

vi.mock("@/lib/notifications/queue", () => ({
  queueNotification: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/tipos-dispositivo-config", () => ({
  tipoValidaImei: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/lib/sucursal", () => ({
  sucursalParaEscritura: vi.fn().mockResolvedValue("suc-1"),
  sucursalParaLectura: vi.fn().mockResolvedValue({ verTodas: true, sucursalId: null }),
}))

vi.mock("@/lib/push/send", () => ({
  sendPushToUsers: vi.fn().mockResolvedValue(undefined),
}))

import { POST } from "@/app/api/ordenes/route"
import { resolveOperador } from "@/lib/operadores"

const mockedResolveOperador = resolveOperador as ReturnType<typeof vi.fn>

const RECEPCIONISTA_ID = "recep-elegido-001"
const SESSION_USER_ID = "user-1"

const MINIMAL_ORDER_BODY = {
  clienteId: "c1",
  dispositivo: "iPhone 14",
  tipoDispositivo: "CELULAR",
  problemaReportado: "No enciende",
}

const MOCK_ORDER = {
  id: "o-new",
  numero_orden: 1,
  codigo_orden: "CEL-001",
  cliente_id: "c1",
  organization_id: "org-1",
  tipo_dispositivo: "CELULAR",
  dispositivo: "iPhone 14",
  problema_reportado: "No enciende",
  estado: "RECIBIDO",
  fecha_ingreso: "2024-01-01",
  fecha_prometida: null,
  public_token: "abc123",
  recibido_por: RECEPCIONISTA_ID,
  clientes: { id: "c1", nombre: "Juan", email: null, telefono: null },
}

describe("POST /api/ordenes — recibido_por", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN", userId: SESSION_USER_ID })
    mockedResolveOperador.mockResolvedValue(RECEPCIONISTA_ID)
  })

  it("persiste recibido_por con el actor resuelto por resolveOperador", async () => {
    const insertSpy = vi.fn().mockReturnValue(
      createChainMock(MOCK_ORDER)
    )

    mockSupabaseFrom({
      ordenes_servicio: { ...createChainMock(MOCK_ORDER), insert: insertSpy } as any,
      organizations: createChainMock({
        nombre: "Mi Taller",
        nombre_mostrar: "Mi Taller Pro",
        slug: "mi-taller",
        moneda: "ARS",
        zona_horaria: "America/Argentina/Buenos_Aires",
        logo_url: null,
        telefono: null,
        direccion: null,
        comprobante_terminos: null,
      }),
    })

    const body = { ...MINIMAL_ORDER_BODY, recibidoPorId: RECEPCIONISTA_ID }
    const res = await POST(createPostRequest(body, "http://localhost/api/ordenes"))
    await parseResponse(res)

    expect(mockedResolveOperador).toHaveBeenCalledWith(
      "org-1",
      RECEPCIONISTA_ID,
      SESSION_USER_ID
    )

    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ recibido_por: RECEPCIONISTA_ID })
    )
  })

  it("usa fallback al userId de sesión cuando no se envía recibidoPorId", async () => {
    mockedResolveOperador.mockResolvedValue(SESSION_USER_ID)

    const insertSpy = vi.fn().mockReturnValue(
      createChainMock({ ...MOCK_ORDER, recibido_por: SESSION_USER_ID })
    )

    mockSupabaseFrom({
      ordenes_servicio: { ...createChainMock(MOCK_ORDER), insert: insertSpy } as any,
      organizations: createChainMock({ nombre: "Mi Taller", nombre_mostrar: "Mi Taller Pro" }),
    })

    const res = await POST(createPostRequest(MINIMAL_ORDER_BODY, "http://localhost/api/ordenes"))
    await parseResponse(res)

    expect(mockedResolveOperador).toHaveBeenCalledWith(
      "org-1",
      undefined,
      SESSION_USER_ID
    )

    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ recibido_por: SESSION_USER_ID })
    )
  })
})
