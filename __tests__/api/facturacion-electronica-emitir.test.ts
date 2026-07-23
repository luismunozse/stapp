// @vitest-environment node
/**
 * Tests: POST /api/facturacion-electronica/emitir
 *
 * ADMIN-only endpoint. Gate is re-checked server-side (never trusts the
 * client). Idempotent: returns 409 without re-emitting when an `emitido`
 * comprobante already exists for the venta.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  createPostRequest,
  parseResponse,
} from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/facturacion/access", () => ({
  canEmitirFacturaElectronica: vi.fn(),
}))

vi.mock("@/lib/facturacion/crypto", () => ({
  decryptSecret: (s: string) => s,
}))

vi.mock("@/lib/facturacion/tusfacturas-provider", () => ({
  tusFacturasProvider: { emitir: vi.fn() },
}))

vi.mock("@/lib/facturacion/map-venta", () => ({
  mapVentaToEmitirInput: vi.fn(),
}))

import { canEmitirFacturaElectronica } from "@/lib/facturacion/access"
import { tusFacturasProvider } from "@/lib/facturacion/tusfacturas-provider"
import { mapVentaToEmitirInput } from "@/lib/facturacion/map-venta"
import { POST } from "@/app/api/facturacion-electronica/emitir/route"

/**
 * Some tables (comprobantes_fiscales in particular) are queried more than
 * once per request with different intents (select existing, insert
 * pendiente, update final). `mockSupabaseFrom` from helpers.ts maps one
 * chain per table, which can't represent that. This sequences one chain
 * per call, in call order, per table.
 */
function mockSupabaseSequenced(sequence: Record<string, ReturnType<typeof createChainMock>[]>) {
  const counters: Record<string, number> = {}
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    const chains = sequence[table]
    if (!chains || chains.length === 0) {
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    }
    const idx = counters[table] ?? 0
    counters[table] = idx + 1
    return (chains[idx] ?? chains[chains.length - 1]) as any
  })
}

const VENTA = { id: "venta-1", organization_id: "org-1", total: 100, cliente_nombre: "Juan Perez", iva_tasa: 21 }
const ITEMS = [{ id: "it-1", venta_id: "venta-1", descripcion: "Servicio", cantidad: 1, precio_unitario: 100 }]
const CREDENCIALES = {
  organization_id: "org-1",
  apitoken_enc: "tok-enc",
  apikey_enc: "key-enc",
  usertoken_enc: "user-enc",
  punto_venta: 3,
  condicion_fiscal: "MONOTRIBUTO",
}
const MAPPED_INPUT = {
  ventaId: "venta-1",
  moneda: "PES",
  total: 100,
  receptor: { razonSocial: "Juan Perez", documentoTipo: "CONSUMIDOR FINAL", documentoNro: "0", condicionIva: "CF" },
  items: [{ cantidad: 1, descripcion: "Servicio", importeUnitario: 100, alicuotaIva: 21 }],
}

describe("POST /api/facturacion-electronica/emitir", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(mapVentaToEmitirInput).mockReturnValue(MAPPED_INPUT as any)
  })

  it("401 unauthenticated", async () => {
    mockAuthError()

    const { status } = await parseResponse(await POST(createPostRequest({ ventaId: "venta-1" })))

    expect(status).toBe(401)
  })

  it("403 when facturacion electronica gate is disabled", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(false)

    const { status, body } = await parseResponse(await POST(createPostRequest({ ventaId: "venta-1" })))

    expect(status).toBe(403)
    expect(body.error).toBeDefined()
    expect(tusFacturasProvider.emitir).not.toHaveBeenCalled()
  })

  it("400 when ventaId is missing", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(true)

    const { status, body } = await parseResponse(await POST(createPostRequest({})))

    expect(status).toBe(400)
    expect(body.error).toBeDefined()
  })

  it("409 when an emitido comprobante already exists (idempotent, does not re-emit)", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(true)
    const existing = { id: "cmp-0", venta_id: "venta-1", estado: "emitido", cae: "111" }
    mockSupabaseSequenced({
      comprobantes_fiscales: [createChainMock(existing)],
    })

    const { status, body } = await parseResponse(await POST(createPostRequest({ ventaId: "venta-1" })))

    expect(status).toBe(409)
    expect(body.yaEmitido).toBe(true)
    expect(body.comprobante).toEqual(existing)
    expect(tusFacturasProvider.emitir).not.toHaveBeenCalled()
  })

  it("200 + estado emitido on provider success", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(true)
    vi.mocked(tusFacturasProvider.emitir).mockResolvedValue({
      ok: true,
      cae: "1",
      numero: "0003-1",
      tipo: "C",
      pdfUrl: "http://p",
      raw: {},
    } as any)
    const updated = { id: "cmp-1", estado: "emitido", cae: "1", numero: "0003-1", pdf_url: "http://p" }
    mockSupabaseSequenced({
      comprobantes_fiscales: [
        createChainMock(null), // existing check -> none
        createChainMock({ id: "cmp-1" }), // insert pendiente
        createChainMock(updated), // update -> emitido
      ],
      ventas: [createChainMock(VENTA)],
      items_venta: [createChainMock(ITEMS)],
      facturacion_credenciales: [createChainMock(CREDENCIALES)],
    })

    const { status, body } = await parseResponse(await POST(createPostRequest({ ventaId: "venta-1" })))

    expect(status).toBe(200)
    expect(body.comprobante.estado).toBe("emitido")
    expect(body.comprobante.cae).toBe("1")
    expect(tusFacturasProvider.emitir).toHaveBeenCalledTimes(1)
  })

  it("422 + estado rechazado on provider failure", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(true)
    vi.mocked(tusFacturasProvider.emitir).mockResolvedValue({
      ok: false,
      errores: ["CUIT invalido"],
      raw: {},
    } as any)
    const rejected = { id: "cmp-1", estado: "rechazado", error_msg: "CUIT invalido" }
    mockSupabaseSequenced({
      comprobantes_fiscales: [
        createChainMock(null), // existing check -> none
        createChainMock({ id: "cmp-1" }), // insert pendiente
        createChainMock(rejected), // update -> rechazado
      ],
      ventas: [createChainMock(VENTA)],
      items_venta: [createChainMock(ITEMS)],
      facturacion_credenciales: [createChainMock(CREDENCIALES)],
    })

    const { status, body } = await parseResponse(await POST(createPostRequest({ ventaId: "venta-1" })))

    expect(status).toBe(422)
    expect(body.comprobante.estado).toBe("rechazado")
    expect(body.error).toBeDefined()
  })
})
