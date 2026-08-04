/**
 * Atomicidad de POST /api/recepciones.
 *
 * Toda la creacion pasa por la RPC crear_recepcion_multiple, asi que un fallo
 * (incluido el limite del plan via trigger) rollbackea el lote completo. Estos
 * tests fijan que la ruta NO hace inserts sueltos en ordenes_servicio.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"
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
import { isPlanLimitError, planLimitErrorResponse } from "@/lib/plan-limits"
import { POST } from "@/app/api/recepciones/route"

const body = {
  clienteId: "cli-1",
  terminosAceptados: true,
  firmaCliente: "data:image/png;base64,abc",
  firmaMime: "image/png",
  equipos: [
    { dispositivo: "iPhone 13", tipoDispositivo: "CELULAR", problemaReportado: "No enciende" },
    { dispositivo: "Notebook HP", tipoDispositivo: "COMPUTADORA", problemaReportado: "Muy lenta" },
  ],
}

const rpcOk = {
  recepcion: { id: "rec-1", numero: 1, codigo: "REC001" },
  ordenes: [
    { id: "ord-1", numeroOrden: 1, codigoOrden: "CEL001", dispositivo: "iPhone 13", publicToken: "aaa" },
    { id: "ord-2", numeroOrden: 2, codigoOrden: "PC002", dispositivo: "Notebook HP", publicToken: "bbb" },
  ],
}

describe("POST /api/recepciones — atomicidad", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // clearAllMocks limpia llamadas pero NO implementaciones: sin esto, el
    // mockReturnValue(true) del test de limite de plan se filtraria a los
    // tests siguientes.
    vi.mocked(isPlanLimitError).mockReturnValue(false)
    mockAuthSuccess()
    mockSupabaseFrom({
      orden_eventos: createChainMock(null, null),
      fotos_orden: createChainMock(null, null),
    })
  })

  it("crea todo por la RPC y no inserta ordenes por separado", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: rpcOk, error: null } as any)
    const ordenesChain = createChainMock(null, null)
    mockSupabaseFrom({
      ordenes_servicio: ordenesChain,
      orden_eventos: createChainMock(null, null),
      fotos_orden: createChainMock(null, null),
    })

    const res = await POST(createPostRequest(body))
    const { status, body: json } = await parseResponse(res)

    expect(status).toBe(201)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("crear_recepcion_multiple", expect.any(Object))
    expect(ordenesChain.insert).not.toHaveBeenCalled()
    expect(json.ordenes).toHaveLength(2)
  })

  it("incluye los datos de la organizacion (telefono, direccion, terminos) en la respuesta", async () => {
    // POST /api/ordenes ya devuelve estos campos en su propia respuesta (ver
    // app/api/ordenes/route.ts:544-548); este endpoint hace lo mismo para que
    // el comprobante y el WhatsApp agrupado del modal de exito no dependan de
    // un segundo fetch a /api/configuracion (que ademas es ADMIN-only).
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: rpcOk, error: null } as any)
    mockSupabaseFrom({
      orden_eventos: createChainMock(null, null),
      fotos_orden: createChainMock(null, null),
      organizations: createChainMock(
        {
          nombre: "Taller SRL",
          nombre_mostrar: "Taller Central",
          telefono: "1122334455",
          direccion: "Av. Siempre Viva 742",
          comprobante_terminos: "El equipo se entrega contra presentacion de este comprobante.",
        },
        null,
      ),
    })

    const res = await POST(createPostRequest(body))
    const { status, body: json } = await parseResponse(res)

    expect(status).toBe(201)
    expect(json.organizationName).toBe("Taller Central")
    expect(json.organizationTelefono).toBe("1122334455")
    expect(json.organizationDireccion).toBe("Av. Siempre Viva 742")
    expect(json.organizationComprobanteTerminos).toBe(
      "El equipo se entrega contra presentacion de este comprobante.",
    )
  })

  it("devuelve 500 y no crea nada cuando la RPC falla", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { message: "error inesperado de base" },
    } as any)
    const ordenesChain = createChainMock(null, null)
    mockSupabaseFrom({
      ordenes_servicio: ordenesChain,
      orden_eventos: createChainMock(null, null),
      fotos_orden: createChainMock(null, null),
    })

    const res = await POST(createPostRequest(body))
    const { status } = await parseResponse(res)

    expect(status).toBe(500)
    expect(ordenesChain.insert).not.toHaveBeenCalled()
  })

  it("mapea el limite del plan a 403 PLAN_LIMIT_EXCEEDED en vez de un 500 generico", async () => {
    // El trigger update_ordenes_count (167_atomic_plan_limit_enforcement.sql)
    // rollbackea el lote entero y raisea PLAN_LIMIT_EXCEEDED. Ese error llega
    // como rpcError y la ruta lo traduce con isPlanLimitError ->
    // planLimitErrorResponse: es el mensaje que ve el operador de mostrador
    // cuando el lote no entra en el plan, no un "Error al crear la recepcion".
    const rpcError = { message: "PLAN_LIMIT_EXCEEDED:ordenes:50:50" }
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: rpcError } as any)
    vi.mocked(isPlanLimitError).mockReturnValue(true)
    vi.mocked(planLimitErrorResponse).mockReturnValue(
      NextResponse.json(
        { error: "Llegaste al limite del plan", code: "PLAN_LIMIT_EXCEEDED", limitType: "ordenes" },
        { status: 403 },
      ) as any,
    )
    const ordenesChain = createChainMock(null, null)
    mockSupabaseFrom({
      ordenes_servicio: ordenesChain,
      orden_eventos: createChainMock(null, null),
      fotos_orden: createChainMock(null, null),
    })

    const res = await POST(createPostRequest(body))
    const { status, body: json } = await parseResponse(res)

    expect(status).toBe(403)
    expect(json.code).toBe("PLAN_LIMIT_EXCEEDED")
    expect(planLimitErrorResponse).toHaveBeenCalledWith(rpcError)
    expect(ordenesChain.insert).not.toHaveBeenCalled()
  })

  it("rechaza con 400 cuando viene un solo equipo", async () => {
    const res = await POST(createPostRequest({ ...body, equipos: [body.equipos[0]] }))
    const { status, body: json } = await parseResponse(res)

    expect(status).toBe(400)
    expect(json.error).toContain("al menos 2 equipos")
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })
})
