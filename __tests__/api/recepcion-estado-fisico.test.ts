/**
 * Estado físico por equipo en POST /api/recepciones.
 *
 * Cada equipo puede traer pins (`danos`) o "Sin daños visibles"
 * (`recepcionSinDanos`). La ruta valida igual que POST /api/ordenes (por equipo)
 * y se los pasa a crear_recepcion_multiple, que los registra en la misma
 * transacción: un fallo no deja órdenes sueltas.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, createPostRequest, parseResponse } from "./helpers"

vi.mock("@/lib/subscriptions", () => ({ hasPlanFeature: vi.fn().mockResolvedValue(true) }))
vi.mock("@/lib/plan-limits", () => ({
  enforcePlanLimit: vi.fn().mockResolvedValue(null),
  isPlanLimitError: vi.fn().mockReturnValue(false),
  planLimitErrorResponse: vi.fn(),
}))
vi.mock("@/lib/sucursal", () => ({ sucursalParaEscritura: vi.fn().mockResolvedValue("suc-1") }))
vi.mock("@/lib/operadores", () => ({ resolveOperador: vi.fn().mockResolvedValue("user-1") }))
vi.mock("@/lib/tipos-dispositivo-config", () => ({ tipoValidaImei: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/audit", () => ({ createAuditLogger: () => ({ create: vi.fn().mockResolvedValue(undefined) }) }))

import { supabaseAdmin } from "@/lib/supabase"
import { POST } from "@/app/api/recepciones/route"

const pinCelular = { diagrama: "celular@1", vista: "frente", x: 0.2, y: 0.3, tipo: "rayon", nota: "borde" }

const equipoCelular = { dispositivo: "iPhone 13", tipoDispositivo: "CELULAR", problemaReportado: "No enciende" }
const equipoPc = { dispositivo: "Notebook HP", tipoDispositivo: "COMPUTADORA", problemaReportado: "Muy lenta" }

const base = {
  clienteId: "cli-1",
  terminosAceptados: true,
  firmaCliente: "data:image/png;base64,abc",
  firmaMime: "image/png",
}

const rpcOk = {
  recepcion: { id: "rec-1", numero: 1, codigo: "REC001" },
  ordenes: [
    { id: "ord-1", numeroOrden: 1, codigoOrden: "CEL001", dispositivo: "iPhone 13", publicToken: "aaa" },
    { id: "ord-2", numeroOrden: 2, codigoOrden: "PC002", dispositivo: "Notebook HP", publicToken: "bbb" },
  ],
}

function mockTablas(org: Record<string, unknown> | null = null) {
  mockSupabaseFrom({
    clientes: createChainMock({ id: "c1" }),
    orden_eventos: createChainMock(null, null),
    fotos_orden: createChainMock(null, null),
    organizations: createChainMock(org, null),
  })
}

function equiposEnviadosALaRpc() {
  const call = vi.mocked(supabaseAdmin.rpc).mock.calls.find(([fn]) => fn === "crear_recepcion_multiple")
  return (call?.[1] as { p_equipos: Array<Record<string, unknown>> }).p_equipos
}

describe("POST /api/recepciones — estado físico por equipo", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
    mockTablas()
  })

  it("pasa los pins y el 'sin daños' de cada equipo a la RPC", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: rpcOk, error: null } as any)

    const res = await POST(
      createPostRequest({
        ...base,
        equipos: [
          { ...equipoCelular, danos: [pinCelular] },
          { ...equipoPc, recepcionSinDanos: true },
        ],
      }),
    )
    expect(res.status).toBe(201)

    const equipos = equiposEnviadosALaRpc()
    expect(equipos[0].danos).toEqual([pinCelular])
    expect(equipos[0].recepcionSinDanos).toBe(false)
    expect(equipos[1].danos).toEqual([])
    expect(equipos[1].recepcionSinDanos).toBe(true)
  })

  it("los equipos sin estado físico siguen funcionando (sin pins, sin flag)", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: rpcOk, error: null } as any)

    const res = await POST(createPostRequest({ ...base, equipos: [equipoCelular, equipoPc] }))
    expect(res.status).toBe(201)

    const equipos = equiposEnviadosALaRpc()
    expect(equipos[0].danos).toEqual([])
    expect(equipos[0].recepcionSinDanos).toBe(false)
  })

  it("rechaza pins y 'sin daños' a la vez en un equipo, sin llamar a la RPC", async () => {
    const res = await POST(
      createPostRequest({
        ...base,
        equipos: [equipoCelular, { ...equipoCelular, danos: [pinCelular], recepcionSinDanos: true }],
      }),
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toContain("Equipo 2")
    expect(body.error).toContain("«Sin daños visibles» a la vez")
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("rechaza una vista que no existe en el dibujo del tipo de ese equipo", async () => {
    const res = await POST(
      createPostRequest({
        ...base,
        equipos: [{ ...equipoCelular, danos: [{ ...pinCelular, vista: "lateral" }] }, equipoPc],
      }),
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toContain("Equipo 1")
    expect(body.error).toContain('La vista "lateral" no existe')
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("rechaza pins de otro dibujo (pins de celular en una computadora)", async () => {
    const res = await POST(
      createPostRequest({
        ...base,
        equipos: [equipoCelular, { ...equipoPc, danos: [pinCelular] }],
      }),
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toContain("Equipo 2")
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("con el estado físico obligatorio, el equipo que no lo tiene da 400 nombrando el equipo", async () => {
    mockTablas({ danos_recepcion_obligatorio: true })

    const res = await POST(
      createPostRequest({
        ...base,
        equipos: [{ ...equipoCelular, recepcionSinDanos: true }, equipoPc],
      }),
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toContain("Equipo 2")
    expect(body.error).toContain("Sin daños visibles")
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("con el estado físico obligatorio y todos los equipos completos, crea la recepción", async () => {
    mockTablas({ danos_recepcion_obligatorio: true })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: rpcOk, error: null } as any)

    const res = await POST(
      createPostRequest({
        ...base,
        equipos: [{ ...equipoCelular, danos: [pinCelular] }, { ...equipoPc, recepcionSinDanos: true }],
      }),
    )
    expect(res.status).toBe(201)
  })

  it("traduce un error DANOS_* de la RPC con mensajeErrorDanos", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { message: "DANOS_SIN_DANOS_CON_PINS", code: "P0001" },
    } as any)

    const res = await POST(
      createPostRequest({ ...base, equipos: [{ ...equipoCelular, danos: [pinCelular] }, equipoPc] }),
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(409)
    expect(body.error).toBe('No se puede marcar "sin daños" si hay daños marcados')
  })

  it("rechaza más de 30 pins en un equipo", async () => {
    const res = await POST(
      createPostRequest({
        ...base,
        equipos: [{ ...equipoCelular, danos: Array.from({ length: 31 }, () => pinCelular) }, equipoPc],
      }),
    )
    expect(res.status).toBe(400)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })
})
