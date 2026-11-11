import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, parseResponse, createPostRequest } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

import { POST } from "@/app/api/notas-credito/route"
import { DELETE } from "@/app/api/notas-credito/[id]/route"

const URL_NC = "http://localhost/api/notas-credito"

function setupPost(rpc: { data: any; error: any }, movimientos: any[] = []) {
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue(rpc as any)
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table === "ordenes_servicio") return createChainMock({ id: "o1", sucursal_id: "suc-1" }) as any
    if (table === "sesiones_caja") return createChainMock({ id: "ses-1" }) as any
    if (table === "movimientos_caja") {
      return {
        insert: vi.fn().mockImplementation((payload: any) => {
          movimientos.push(payload)
          return Promise.resolve({ data: null, error: null })
        }),
      } as any
    }
    return createChainMock(null) as any
  })
}

const body = (extra: Record<string, unknown> = {}) => ({
  ordenId: "o1",
  motivo: "DEVOLUCION",
  monto: 500,
  metodoDevolucion: "EFECTIVO",
  ...extra,
})

describe("POST /api/notas-credito — tope de lo cobrado", () => {
  beforeEach(() => vi.clearAllMocks())

  it("la RPC rechaza por superar lo cobrado (P0040) -> 409 con el mensaje y sin egreso de caja", async () => {
    const movimientos: any[] = []
    mockAuthSuccess({ role: "ADMIN" })
    setupPost(
      {
        data: null,
        error: { code: "P0040", message: "La nota de crédito supera lo cobrado de la orden. Disponible: 200.00" },
      },
      movimientos
    )

    const res = await POST(createPostRequest(body(), URL_NC))
    const { status, body: json } = await parseResponse(res)

    expect(status).toBe(409)
    expect(json.error).toMatch(/supera lo cobrado/)
    expect(movimientos).toHaveLength(0)
  })

  it("la clave reutilizada en otra orden (P0041) -> 409", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    setupPost({ data: null, error: { code: "P0041", message: "La clave de idempotencia ya se usó en otra orden" } })

    const res = await POST(createPostRequest(body({ idempotencyKey: "k1" }), URL_NC))
    expect((await parseResponse(res)).status).toBe(409)
  })
})

describe("POST /api/notas-credito — idempotencia", () => {
  beforeEach(() => vi.clearAllMocks())

  it("pasa la clave del cliente a la RPC", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    setupPost({ data: { success: true, id: "nc1", numero: "NC-0001" }, error: null })

    await POST(createPostRequest(body({ idempotencyKey: "clave-1" }), URL_NC))

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "crear_nota_credito",
      expect.objectContaining({ p_idempotency_key: "clave-1" })
    )
  })

  it("sin clave manda null", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    setupPost({ data: { success: true, id: "nc1", numero: "NC-0001" }, error: null })

    await POST(createPostRequest(body(), URL_NC))

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "crear_nota_credito",
      expect.objectContaining({ p_idempotency_key: null })
    )
  })

  it("un reintento devuelve la NC existente (200) y no registra otro egreso de caja", async () => {
    const movimientos: any[] = []
    mockAuthSuccess({ role: "ADMIN" })
    setupPost({ data: { success: true, id: "nc1", numero: "NC-0001", replayed: true }, error: null }, movimientos)

    const res = await POST(createPostRequest(body({ idempotencyKey: "clave-1" }), URL_NC))
    const { status, body: json } = await parseResponse(res)

    expect(status).toBe(200)
    expect(json).toMatchObject({ success: true, id: "nc1", numero: "NC-0001" })
    expect(movimientos).toHaveLength(0)
  })

  it("la primera vez sigue registrando el egreso (201)", async () => {
    const movimientos: any[] = []
    mockAuthSuccess({ role: "ADMIN" })
    setupPost({ data: { success: true, id: "nc1", numero: "NC-0001" }, error: null }, movimientos)

    const res = await POST(createPostRequest(body({ idempotencyKey: "clave-1" }), URL_NC))

    expect((await parseResponse(res)).status).toBe(201)
    expect(movimientos).toHaveLength(1)
  })
})

// ── DELETE ────────────────────────────────────────────────────────────────

function setupDelete(nc: any, updateResult: any = { id: "nc1" }) {
  const updates: any[] = []
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: null } as any)
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table !== "notas_credito") return createChainMock(null) as any
    const chain = createChainMock(nc)
    chain.update = vi.fn().mockImplementation((payload: any) => {
      updates.push(payload)
      return createChainMock(updateResult)
    })
    return chain as any
  })
  return updates
}

const nc = (extra: Record<string, unknown> = {}) => ({
  id: "nc1",
  numero: "NC-0001",
  anulada: false,
  orden_id: "o1",
  metodo_devolucion: "NOTA_CREDITO_INTERNA",
  monto_aplicado_deuda: 0,
  items_nota_credito: [],
  ...extra,
})

const borrar = () =>
  DELETE(new Request("http://localhost/api/notas-credito/nc1?motivo=error", { method: "DELETE" }), {
    params: Promise.resolve({ id: "nc1" }),
  })

describe("DELETE /api/notas-credito/[id] — no anula una NC que ya movió dinero o stock", () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(["EFECTIVO", "CUENTA_CORRIENTE", "TRANSFERENCIA", "TARJETA", "MERCADOPAGO", "OTRO"])(
    "reintegro en %s -> 409 y no la marca anulada",
    async (metodo) => {
      mockAuthSuccess({ role: "ADMIN" })
      const updates = setupDelete(nc({ metodo_devolucion: metodo }))

      const res = await borrar()
      const { status, body: json } = await parseResponse(res)

      expect(status).toBe(409)
      expect(json.error).toMatch(/no se puede anular/i)
      expect(updates).toHaveLength(0)
    }
  )

  it("repuso stock -> 409 y no la marca anulada", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const updates = setupDelete(
      nc({ items_nota_credito: [{ inventario_id: "inv1", restock: true }] })
    )

    const res = await borrar()
    const { status, body: json } = await parseResponse(res)

    expect(status).toBe(409)
    expect(json.error).toMatch(/stock/i)
    expect(updates).toHaveLength(0)
  })

  it("NC interna sin reposición de stock -> se anula", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const updates = setupDelete(
      nc({ items_nota_credito: [{ inventario_id: "inv1", restock: false }, { inventario_id: null, restock: true }] })
    )

    const res = await borrar()

    expect((await parseResponse(res)).status).toBe(200)
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ anulada: true, anulada_motivo: "error" })
  })

  it("sin método de devolución -> se anula", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const updates = setupDelete(nc({ metodo_devolucion: null }))

    expect((await parseResponse(await borrar())).status).toBe(200)
    expect(updates).toHaveLength(1)
  })

  it("si bajó deuda, recalcula el estado de cobro de la orden", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    setupDelete(nc({ monto_aplicado_deuda: 300 }))

    expect((await parseResponse(await borrar())).status).toBe(200)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("recalcular_estado_cobro", { p_orden_id: "o1" })
  })

  it("otra anulación concurrente ganó (el UPDATE condicional no tocó filas) -> 409", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    setupDelete(nc(), null)

    expect((await parseResponse(await borrar())).status).toBe(409)
  })

  it("ya anulada -> 400", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const updates = setupDelete(nc({ anulada: true }))

    expect((await parseResponse(await borrar())).status).toBe(400)
    expect(updates).toHaveLength(0)
  })
})
