/**
 * "Trabajo a realizar": el campo opcional de la orden de ingreso tiene que
 * llegar a la base en el alta clasica, la recepcion multiple (via RPC) y la
 * edicion. Se asierta contra el payload real del insert/update/rpc, no contra
 * la respuesta: un mock que ignora el payload daria un falso verde.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, createPostRequest, parseResponse } from "./helpers"

vi.mock("@/lib/subscriptions", () => ({ hasPlanFeature: vi.fn().mockResolvedValue(true) }))
vi.mock("@/lib/plan-limits", () => ({
  enforcePlanLimit: vi.fn().mockResolvedValue(null),
  isPlanLimitError: vi.fn().mockReturnValue(false),
  planLimitErrorResponse: vi.fn(),
}))
vi.mock("@/lib/counters", () => ({
  getNextOrderNumberByType: vi.fn().mockResolvedValue({ codigo: "CEL001", numero: 1 }),
}))
vi.mock("@/lib/operadores", () => ({ resolveOperador: vi.fn().mockResolvedValue("user-1") }))
vi.mock("@/lib/sucursal", () => ({
  sucursalParaEscritura: vi.fn().mockResolvedValue("suc-1"),
  sucursalParaLectura: vi.fn().mockResolvedValue({ verTodas: true, sucursalId: null }),
}))
vi.mock("@/lib/notifications/queue", () => ({ queueNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/webhooks/dispatcher", () => ({ emitWebhookEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/audit", () => ({
  createAuditLogger: () => ({
    create: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
  }),
  diffObjects: vi.fn().mockReturnValue({ before: {}, after: {} }),
}))
vi.mock("@/lib/tipos-dispositivo-config", () => ({ tipoValidaImei: vi.fn().mockResolvedValue(false) }))

import { supabaseAdmin } from "@/lib/supabase"
import { POST as POST_ORDEN } from "@/app/api/ordenes/route"
import { PUT as PUT_ORDEN } from "@/app/api/ordenes/[id]/route"
import { POST as POST_RECEPCION } from "@/app/api/recepciones/route"

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
  trabajo_a_realizar: "Cambio de pantalla",
  clientes: { id: "cli-1", nombre: "Juan", email: null, telefono: "1122334455" },
}

const base = {
  clienteId: "cli-1",
  dispositivo: "iPhone 13",
  tipoDispositivo: "CELULAR",
  problemaReportado: "No enciende",
}

async function crearOrden(extra: Record<string, unknown>) {
  const ordenesChain = createChainMock(ordenCreada, null)
  const orgChain = createChainMock({ nombre: "Taller", slug: "t", garantia_dias_default: 30 }, null)
  mockSupabaseFrom({
    ordenes_servicio: ordenesChain,
    organizations: orgChain,
    orden_eventos: createChainMock(null, null),
  })
  const res = await POST_ORDEN(createPostRequest({ ...base, ...extra }))
  const parsed = await parseResponse(res)
  return { ordenesChain, orgChain, ...parsed }
}

describe("POST /api/ordenes - trabajo a realizar", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it("inserta trabajo_a_realizar recortado", async () => {
    const { ordenesChain, status } = await crearOrden({ trabajoARealizar: "  Cambio de pantalla + bateria  " })
    expect(status).toBe(201)
    const payload = ordenesChain.insert.mock.calls[0][0] as Record<string, unknown>
    expect(payload.trabajo_a_realizar).toBe("Cambio de pantalla + bateria")
  })

  it("string vacio no se persiste como texto (queda null o ausente)", async () => {
    const { ordenesChain, status } = await crearOrden({ trabajoARealizar: "   " })
    expect(status).toBe(201)
    const payload = ordenesChain.insert.mock.calls[0][0] as Record<string, unknown>
    expect(payload.trabajo_a_realizar ?? null).toBeNull()
  })

  it("sin el campo, el insert no lo menciona (compatible con migracion sin aplicar)", async () => {
    const { ordenesChain } = await crearOrden({})
    const payload = ordenesChain.insert.mock.calls[0][0] as Record<string, unknown>
    expect("trabajo_a_realizar" in payload).toBe(false)
  })

  it("rechaza textos de mas de 2000 caracteres", async () => {
    const { status } = await crearOrden({ trabajoARealizar: "x".repeat(2001) })
    expect(status).toBe(400)
  })

  it("devuelve trabajo y garantia por defecto para el comprobante termico", async () => {
    const { orgChain, body } = await crearOrden({ trabajoARealizar: "Cambio de pantalla" })
    const selects = orgChain.select.mock.calls.map((c: unknown[]) => String(c[0])).join(" ")
    expect(selects).toContain("garantia_dias_default")
    expect(body.trabajoARealizar).toBe("Cambio de pantalla")
    expect(body.organizationGarantiaDiasDefault).toBe(30)
  })
})

describe("PUT /api/ordenes/[id] - trabajo a realizar", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  async function editar(body: Record<string, unknown>) {
    const actual = {
      id: "o1",
      numero_orden: 1,
      cliente_id: "c1",
      tecnico_id: "t1",
      organization_id: "org-1",
      estado: "RECIBIDO",
      problema_reportado: "x",
      clientes: { id: "c1", nombre: "Juan", email: null, telefono: "1" },
      organizations: { id: "org-1", nombre: "Taller", moneda: "ARS", zona_horaria: "UTC" },
    }
    const chain = createChainMock(actual, null)
    mockSupabaseFrom({ ordenes_servicio: chain, orden_eventos: createChainMock(null, null) })
    const res = await PUT_ORDEN(
      new Request("http://localhost:3000/api/ordenes/o1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: "o1" }) },
    )
    return { chain, ...(await parseResponse(res)) }
  }

  it("actualiza trabajo_a_realizar recortado", async () => {
    const { chain, status } = await editar({ trabajoARealizar: " Cambio de bateria " })
    expect(status).toBe(200)
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ trabajo_a_realizar: "Cambio de bateria" }))
  })

  it("string vacio limpia el campo (null)", async () => {
    const { chain, status } = await editar({ trabajoARealizar: "" })
    expect(status).toBe(200)
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ trabajo_a_realizar: null }))
  })

  it("si no viene, no toca la columna", async () => {
    const { chain } = await editar({ observaciones: "hola" })
    const payload = chain.update.mock.calls[0][0] as Record<string, unknown>
    expect("trabajo_a_realizar" in payload).toBe(false)
  })
})

describe("POST /api/recepciones - trabajo a realizar", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it("manda trabajoARealizar por equipo a la RPC (vacio como null)", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: {
        recepcion: { id: "rec-1", numero: 1, codigo: "REC001" },
        ordenes: [
          { id: "o1", numeroOrden: 1, codigoOrden: "A1", dispositivo: "a", publicToken: "x" },
          { id: "o2", numeroOrden: 2, codigoOrden: "A2", dispositivo: "b", publicToken: "y" },
        ],
      },
      error: null,
    } as any)
    mockSupabaseFrom({
      orden_eventos: createChainMock(null, null),
      fotos_orden: createChainMock(null, null),
      organizations: createChainMock({ nombre: "T", garantia_dias_default: 15 }, null),
    })

    const res = await POST_RECEPCION(
      createPostRequest({
        clienteId: "cli-1",
        terminosAceptados: true,
        equipos: [
          { dispositivo: "a", tipoDispositivo: "CELULAR", problemaReportado: "p", trabajoARealizar: " Pantalla " },
          { dispositivo: "b", tipoDispositivo: "CELULAR", problemaReportado: "p", trabajoARealizar: "" },
        ],
      }),
    )
    const { status, body } = await parseResponse(res)
    expect(status).toBe(201)
    const args = vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as { p_equipos: Array<Record<string, unknown>> }
    expect(args.p_equipos[0].trabajoARealizar).toBe("Pantalla")
    expect(args.p_equipos[1].trabajoARealizar).toBeNull()
    expect(body.organizationGarantiaDiasDefault).toBe(15)
  })
})
