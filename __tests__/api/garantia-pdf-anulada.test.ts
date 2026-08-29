/**
 * An annulled warranty must stop emitting its certificate.
 *
 * Since the return retires the warranty (`ANULADA`, migration 316), the PDF
 * route kept emitting the certificate for it — the query filters by id, venta
 * and org, never by estado. So a customer who returned the product and got
 * refunded could still download a document saying the warranty is valid, and
 * `whatsapp-templates.ts` could still send them the link.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, createGetRequest, parseResponse } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/pdf", () => ({
  generateGarantiaVentaPDF: vi.fn().mockResolvedValue(Buffer.from("PDF")),
}))

import { GET } from "@/app/api/ventas/[id]/garantia/[garantiaId]/pdf/route"
import { generateGarantiaVentaPDF } from "@/lib/pdf"

const createParams = (id: string, garantiaId: string) => ({
  params: Promise.resolve({ id, garantiaId }),
})

const VENTA = {
  id: "v1",
  numero_venta: 1,
  cliente_nombre: "Ana",
  vendedor_id: "user-1",
  created_at: "2026-01-01T00:00:00Z",
  organizations: {
    nombre: "Taller",
    nombre_mostrar: "Taller",
    telefono: null,
    direccion: null,
    logo_url: null,
    moneda: "ARS",
    zona_horaria: "America/Argentina/Buenos_Aires",
  },
}

const garantia = (estado: string) => ({
  id: "g1",
  venta_id: "v1",
  organization_id: "org-1",
  numero_garantia: "GAR-000003",
  dias_validez: 30,
  fecha_inicio: "2026-01-01",
  fecha_vencimiento: "2026-09-13",
  estado,
  items_venta: { descripcion: "Auriculares", cantidad: 1, precio_unitario: 100, inventario: null },
})

function setup(estado: string) {
  mockAuthSuccess({ role: "ADMIN" })
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table === "ventas") return createChainMock(VENTA) as any
    if (table === "garantias_venta") return createChainMock(garantia(estado)) as any
    return createChainMock(null) as any
  })
}

async function get() {
  return parseResponse(
    await GET(
      createGetRequest("http://localhost/api/ventas/v1/garantia/g1/pdf"),
      createParams("v1", "g1")
    ) as any
  )
}

describe("GET /api/ventas/[id]/garantia/[garantiaId]/pdf — estado", () => {
  beforeEach(() => vi.clearAllMocks())

  it("refuses to emit the certificate of an annulled warranty", async () => {
    setup("ANULADA")

    const { status, body } = await get()

    expect(status).toBe(410)
    expect(body.error).toMatch(/anulada/i)
    expect(generateGarantiaVentaPDF).not.toHaveBeenCalled()
  })

  it("still emits it for an active warranty", async () => {
    setup("ACTIVA")

    const res = await GET(
      createGetRequest("http://localhost/api/ventas/v1/garantia/g1/pdf"),
      createParams("v1", "g1")
    )

    expect(res.status).toBe(200)
    expect(generateGarantiaVentaPDF).toHaveBeenCalled()
  })

  it("still emits it for an expired warranty", async () => {
    // VENCIDA is not the same as ANULADA: the warranty existed and ran its term,
    // so the customer keeps a right to the document that proves it.
    setup("VENCIDA")

    const res = await GET(
      createGetRequest("http://localhost/api/ventas/v1/garantia/g1/pdf"),
      createParams("v1", "g1")
    )

    expect(res.status).toBe(200)
    expect(generateGarantiaVentaPDF).toHaveBeenCalled()
  })

  it("still emits it for a claimed warranty", async () => {
    setup("RECLAMADA")

    const res = await GET(
      createGetRequest("http://localhost/api/ventas/v1/garantia/g1/pdf"),
      createParams("v1", "g1")
    )

    expect(res.status).toBe(200)
    expect(generateGarantiaVentaPDF).toHaveBeenCalled()
  })
})
