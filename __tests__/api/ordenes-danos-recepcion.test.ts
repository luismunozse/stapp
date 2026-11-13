// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

// La pertenencia de cliente/sector se prueba en ordenes-referencias-org.test.ts.
vi.mock("@/lib/referencias-cliente", () => ({ validarClienteYSector: vi.fn().mockResolvedValue(null) }))
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
import { supabaseAdmin } from "@/lib/supabase"

const BODY = {
  clienteId: "c1",
  dispositivo: "iPhone 14",
  tipoDispositivo: "CELULAR",
  problemaReportado: "No enciende",
}

const DANO = { diagrama: "celular@1", vista: "frente", x: 0.5, y: 0.5, tipo: "rayon", nota: null }
const DANO2 = { diagrama: "celular@1", vista: "dorso", x: 0.2, y: 0.8, tipo: "golpe", nota: "esquina" }

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
  recibido_por: "user-1",
  clientes: { id: "c1", nombre: "Juan", email: null, telefono: null },
}

function setup(obligatorio: boolean) {
  const ordenes = createChainMock(MOCK_ORDER)
  mockSupabaseFrom({
    ordenes_servicio: ordenes as any,
    organizations: createChainMock({ nombre: "Taller", danos_recepcion_obligatorio: obligatorio }),
  })
  return ordenes
}

describe("POST /api/ordenes — estado físico de recepción", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN", userId: "user-1" })
    vi.mocked(resolveOperador).mockResolvedValue("user-1")
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 2, error: null } as any)
  })

  it("rechaza danos y recepcionSinDanos juntos", async () => {
    const ordenes = setup(false)
    const res = await POST(createPostRequest({ ...BODY, danos: [DANO], recepcionSinDanos: true }, "http://localhost/api/ordenes"))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(400)
    expect(body.error).toBe("No podés marcar daños y «Sin daños visibles» a la vez")
    expect(ordenes.insert).not.toHaveBeenCalled()
  })

  it("rechaza un daño con diagrama de otro tipo sin insertar", async () => {
    const ordenes = setup(false)
    const res = await POST(createPostRequest({ ...BODY, danos: [{ ...DANO, diagrama: "tablet@1" }] }, "http://localhost/api/ordenes"))
    const { status } = await parseResponse(res)
    expect(status).toBe(400)
    expect(ordenes.insert).not.toHaveBeenCalled()
  })

  it("da 422 si la org lo exige y no se envía nada", async () => {
    const ordenes = setup(true)
    const res = await POST(createPostRequest(BODY, "http://localhost/api/ordenes"))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(422)
    expect(body.error).toBe("Marcá el estado físico del equipo o indicá «Sin daños visibles»")
    expect(ordenes.insert).not.toHaveBeenCalled()
  })

  it("registra 2 daños con el RPC y devuelve estadoFisicoGuardado", async () => {
    setup(false)
    const res = await POST(createPostRequest({ ...BODY, danos: [DANO, DANO2] }, "http://localhost/api/ordenes"))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(201)
    expect(body.estadoFisicoGuardado).toBe(true)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("registrar_estado_fisico_recepcion", {
      p_orden_id: "o-new",
      p_organization_id: "org-1",
      p_danos: [DANO, DANO2],
      p_sin_danos: false,
      p_user_id: "user-1",
    })
  })

  it("compensa borrando la orden si el RPC falla y la org lo exige", async () => {
    const ordenes = setup(true)
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: { message: "boom" } } as any)
    const res = await POST(createPostRequest({ ...BODY, danos: [DANO] }, "http://localhost/api/ordenes"))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(500)
    expect(body.error).toBe("No se pudo guardar el estado físico")
    expect(ordenes.delete).toHaveBeenCalled()
    expect(ordenes.eq).toHaveBeenCalledWith("id", "o-new")
    expect(ordenes.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("si el RPC falla y la org es opcional, crea la orden con estadoFisicoGuardado=false", async () => {
    const ordenes = setup(false)
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: { message: "boom" } } as any)
    const res = await POST(createPostRequest({ ...BODY, danos: [DANO] }, "http://localhost/api/ordenes"))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(201)
    expect(body.estadoFisicoGuardado).toBe(false)
    expect(ordenes.delete).not.toHaveBeenCalled()
  })

  it("no llama al RPC si no se envía estado físico en una org opcional", async () => {
    setup(false)
    const res = await POST(createPostRequest(BODY, "http://localhost/api/ordenes"))
    const { status } = await parseResponse(res)
    expect(status).toBe(201)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalledWith("registrar_estado_fisico_recepcion", expect.anything())
  })
})
