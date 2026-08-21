import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  createGetRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
}))

import { supabaseAdmin } from "@/lib/supabase"
import { POST } from "@/app/api/cotizaciones/route"
import { GET as getCotizacion, PUT as editarCotizacion } from "@/app/api/cotizaciones/[id]/route"

/**
 * Una línea de cotización que viene del catálogo de servicios guarda de dónde
 * salió, igual que `inventario_id` lo hace para los productos (mig 108). Sirve
 * para trazabilidad; no participa de ningún cálculo.
 */
describe("POST /api/cotizaciones — ítems del catálogo de servicios", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 1, error: null } as any)
  })

  function mockTablas(items: ReturnType<typeof createChainMock>) {
    mockSupabaseFrom({
      clientes: createChainMock({ id: "cli-1", nombre: "Cliente Uno" }),
      organizations: createChainMock({ zona_horaria: "America/Argentina/Buenos_Aires" }),
      cotizaciones: createChainMock({ id: "cot-1", numero_cotizacion: "COT-0001" }),
      items_cotizacion: items,
    })
  }

  it("persiste servicio_id en la línea cuando el ítem viene del catálogo", async () => {
    mockAuthSuccess()
    const items = createChainMock(null, null)
    mockTablas(items)

    await POST(
      createPostRequest({
        clienteId: "cli-1",
        items: [
          {
            descripcion: "Instalación de Windows",
            cantidad: 1,
            precioUnitario: 25000,
            unidad: "Servicio",
            servicioId: "srv-1",
          },
        ],
      })
    )

    const linea = items.insert.mock.calls[0][0][0]
    expect(linea.servicio_id).toBe("srv-1")
  })

  it("deja servicio_id en null cuando el ítem es libre", async () => {
    mockAuthSuccess()
    const items = createChainMock(null, null)
    mockTablas(items)

    await POST(
      createPostRequest({
        clienteId: "cli-1",
        items: [
          { descripcion: "Mano de obra suelta", cantidad: 1, precioUnitario: 8000 },
        ],
      })
    )

    const linea = items.insert.mock.calls[0][0][0]
    expect(linea.servicio_id).toBeNull()
  })
})

const params = { params: Promise.resolve({ id: "cot-1" }) }

describe("PUT /api/cotizaciones/[id] — ítems del catálogo de servicios", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 1, error: null } as any)
  })

  it("persiste servicio_id al reemplazar los ítems", async () => {
    mockAuthSuccess()
    const items = createChainMock(null, null)
    mockSupabaseFrom({
      cotizaciones: createChainMock({
        id: "cot-1",
        estado: "BORRADOR",
        organization_id: "org-1",
        items_cotizacion: [],
      }),
      items_cotizacion: items,
    })

    await editarCotizacion(
      createPostRequest({
        items: [
          {
            descripcion: "Limpieza interna",
            cantidad: 1,
            precioUnitario: 12000,
            unidad: "Servicio",
            servicioId: "srv-2",
          },
        ],
      }),
      params
    )

    const linea = items.insert.mock.calls[0][0][0]
    expect(linea.servicio_id).toBe("srv-2")
  })
})

describe("GET /api/cotizaciones/[id] — DTO de ítems", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 1, error: null } as any)
  })

  it("expone servicioId en el ítem", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      cotizaciones: createChainMock({
        id: "cot-1",
        organization_id: "org-1",
        estado: "BORRADOR",
        items_cotizacion: [
          {
            id: "it-1",
            descripcion: "Instalación de Windows",
            cantidad: 1,
            precio_unitario: 25000,
            subtotal: 25000,
            servicio_id: "srv-1",
          },
        ],
      }),
    })

    const res = await getCotizacion(createGetRequest(), params)
    const { body } = await parseResponse(res)

    expect(body.items[0].servicioId).toBe("srv-1")
  })
})
