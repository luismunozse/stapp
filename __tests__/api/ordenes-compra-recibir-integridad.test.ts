import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  parseResponse,
} from "./helpers"

import { supabaseAdmin } from "@/lib/supabase"
import { POST } from "@/app/api/ordenes-compra/[id]/recibir/route"

/**
 * Recibir mercadería mueve stock, así que las invariantes no pueden vivir solo
 * en el diálogo. Hasta ahora el RPC no filtraba inventario por organización,
 * no revalidaba el estado dentro de la transacción y no tenía forma de
 * distinguir un reintento de una segunda recepción real.
 *
 * Estos tests cubren el contrato de la ruta. La lógica del RPC (locks,
 * idempotencia, scope por organización) vive en SQL y NO está cubierta por
 * esta suite: se verifica aplicando la migración 313 contra la base.
 */

function recibirRequest(body: any, id = "oc-1"): [Request, { params: Promise<{ id: string }> }] {
  const req = new Request(`http://localhost:3000/api/ordenes-compra/${id}/recibir`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  return [req, { params: Promise.resolve({ id }) }]
}

const BODY = {
  items: [{ itemId: "item-1", cantidadRecibida: 3 }],
  requestId: "req-abc-123",
}

function mockOCEnviada() {
  mockSupabaseFrom({
    ordenes_compra: createChainMock({ id: "oc-1", estado: "ENVIADA" }),
  })
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
    data: { success: true, itemsRecibidos: 1, nuevoEstado: "RECIBIDA_PARCIAL" },
    error: null,
  } as any)
}

describe("POST /api/ordenes-compra/[id]/recibir — integridad", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("manda la organización al RPC para que el stock no se pueda tocar cross-tenant", async () => {
    mockAuthSuccess()
    mockOCEnviada()

    const [req, ctx] = recibirRequest(BODY)
    await POST(req, ctx)

    const [, args] = vi.mocked(supabaseAdmin.rpc).mock.calls[0]
    expect((args as any).p_organization_id).toBe("org-1")
  })

  it("propaga el requestId como clave de idempotencia", async () => {
    mockAuthSuccess()
    mockOCEnviada()

    const [req, ctx] = recibirRequest(BODY)
    await POST(req, ctx)

    const [, args] = vi.mocked(supabaseAdmin.rpc).mock.calls[0]
    expect((args as any).p_request_id).toBe("req-abc-123")
  })

  it("exige requestId: sin él un reintento no se puede distinguir de una segunda recepción", async () => {
    mockAuthSuccess()
    mockOCEnviada()

    const [req, ctx] = recibirRequest({ items: BODY.items })
    const res = await POST(req, ctx)
    const { status } = await parseResponse(res)

    expect(status).toBe(400)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("rechaza cantidades absurdas antes de llegar a la base", async () => {
    mockAuthSuccess()
    mockOCEnviada()

    const [req, ctx] = recibirRequest({
      ...BODY,
      items: [{ itemId: "item-1", cantidadRecibida: 2_000_000_000 }],
    })
    const res = await POST(req, ctx)
    const { status } = await parseResponse(res)

    expect(status).toBe(400)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("rechaza items repetidos: el mismo ítem dos veces en un request duplica la cantidad", async () => {
    mockAuthSuccess()
    mockOCEnviada()

    const [req, ctx] = recibirRequest({
      ...BODY,
      items: [
        { itemId: "item-1", cantidadRecibida: 3 },
        { itemId: "item-1", cantidadRecibida: 5 },
      ],
    })
    const res = await POST(req, ctx)
    const { status } = await parseResponse(res)

    expect(status).toBe(400)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("traduce el ítem ajeno a la OC en vez de devolver un éxito parcial mudo", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({ ordenes_compra: createChainMock({ id: "oc-1", estado: "ENVIADA" }) })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: "P0012", message: "item ajeno" },
    } as any)

    const [req, ctx] = recibirRequest(BODY)
    const res = await POST(req, ctx)
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toMatch(/no pertenece/i)
  })

  it("traduce el artículo de otra organización a un error claro", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({ ordenes_compra: createChainMock({ id: "oc-1", estado: "ENVIADA" }) })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: "P0013", message: "inventario ajeno" },
    } as any)

    const [req, ctx] = recibirRequest(BODY)
    const res = await POST(req, ctx)
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toMatch(/no pertenece a tu organización/i)
  })

  it("traduce el estado inválido detectado dentro de la transacción", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({ ordenes_compra: createChainMock({ id: "oc-1", estado: "ENVIADA" }) })
    // La OC cambió de estado entre el chequeo de la ruta y el RPC.
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: "P0014", message: "estado invalido" },
    } as any)

    const [req, ctx] = recibirRequest(BODY)
    const res = await POST(req, ctx)
    const { status, body } = await parseResponse(res)

    expect(status).toBe(409)
    expect(body.error).toMatch(/estado/i)
  })

  it("devuelve el resultado original cuando el RPC marca el request como repetido", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({ ordenes_compra: createChainMock({ id: "oc-1", estado: "ENVIADA" }) })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { success: true, itemsRecibidos: 1, nuevoEstado: "RECIBIDA_PARCIAL", repetido: true },
      error: null,
    } as any)

    const [req, ctx] = recibirRequest(BODY)
    const res = await POST(req, ctx)
    const { status, body } = await parseResponse(res)

    // Un reintento no es un error: devuelve lo mismo que la primera vez.
    expect(status).toBe(200)
    expect(body.repetido).toBe(true)
    expect(body.nuevoEstado).toBe("RECIBIDA_PARCIAL")
  })
})
