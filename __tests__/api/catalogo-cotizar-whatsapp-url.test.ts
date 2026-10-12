import { describe, it, expect, beforeEach, vi } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { mockSupabaseFrom, createChainMock, createPostRequest, parseResponse } from "./helpers"

vi.mock("@/lib/subscriptions", () => ({ hasPlanFeature: vi.fn().mockResolvedValue(true) }))
vi.mock("@/lib/counters", () => ({ getNextQuoteNumber: vi.fn().mockResolvedValue(7) }))

import { POST } from "@/app/api/public/catalogo/[slug]/cotizar/route"

const BODY = {
  cliente: { nombre: "Ana", telefono: "1122334455" },
  consent: true,
  items: [{ itemId: "i1", cantidad: 1 }],
}

function setup(whatsapp: string | null, pais: string | null) {
  mockSupabaseFrom({
    catalogo_config: createChainMock({ organization_id: "org-1", activo: true, whatsapp, titulo: "Taller" }),
    catalogo_items: createChainMock([
      { id: "i1", nombre: "Funda", precio: 100, stock: null, inventario_id: null, activo: true, tipo: "PRODUCTO", inventario: null, variantes: [] },
    ]),
    clientes: createChainMock({ id: "c1", nombre: "Ana", email: null }),
    users: createChainMock([]),
    organizations: createChainMock({ plantillas_whatsapp: null, pais }),
  })
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
    data: { ok: true, cotizacion_id: "cot-1", total: 100, cupon_codigo: null, cupon_descuento: 0 },
    error: null,
  } as never)
}

function call() {
  return POST(createPostRequest(BODY), { params: Promise.resolve({ slug: "mi-taller" }) })
}

describe("POST /api/public/catalogo/[slug]/cotizar — whatsappTallerUrl", () => {
  beforeEach(() => vi.clearAllMocks())

  it("normaliza el WhatsApp crudo del taller con el país de la org", async () => {
    setup("11 1234-5678", "AR")
    const { status, body } = await parseResponse(await call())
    expect(status).toBe(201)
    expect(body.whatsappTallerUrl).toMatch(/^https:\/\/wa\.me\/541112345678\?text=/)
  })

  it("usa el código de país de una org chilena", async () => {
    setup("9 1234 5678", "CL")
    const { body } = await parseResponse(await call())
    expect(body.whatsappTallerUrl).toMatch(/^https:\/\/wa\.me\/56912345678\?text=/)
  })

  it("no devuelve link si el número no es entregable (la cotización igual se crea)", async () => {
    setup("1234-5678", "AR")
    const { status, body } = await parseResponse(await call())
    expect(status).toBe(201)
    expect(body.whatsappTallerUrl).toBeNull()
    expect(body.numeroCotizacion).toBe(7)
  })
})
