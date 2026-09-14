import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
}))

import { supabaseAdmin } from "@/lib/supabase"
import { POST } from "@/app/api/cotizaciones/route"
import { GET as getCotizacion } from "@/app/api/cotizaciones/[id]/route"

const DICTAMEN = {
  veredicto: "IRREPARABLE",
  diagnosticoTecnico: "Placa madre con corrosion por liquido. Sin reparacion posible.",
  causaDano: "LIQUIDO",
}

describe("POST /api/cotizaciones — informe tecnico sin items", () => {
  let cotizaciones: ReturnType<typeof createChainMock>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 1, error: null } as any)
    cotizaciones = createChainMock({ id: "cot-1", numero_cotizacion: "COT-0001" })
    mockSupabaseFrom({
      clientes: createChainMock({ id: "cli-1", nombre: "Cliente Uno" }),
      organizations: createChainMock({ zona_horaria: "America/Argentina/Buenos_Aires" }),
      cotizaciones,
      items_cotizacion: createChainMock(null, null),
    })
  })

  it("guarda el dictamen y la entidad destinataria cuando no hay items", async () => {
    mockAuthSuccess()

    const res = await POST(
      createPostRequest({
        clienteId: "cli-1",
        items: [],
        presentadoAnte: "La Segunda ART",
        ...DICTAMEN,
      })
    )

    expect(res.status).not.toBe(400)
    const fila = cotizaciones.insert.mock.calls[0][0]
    expect(fila.veredicto).toBe("IRREPARABLE")
    expect(fila.causa_dano).toBe("LIQUIDO")
    expect(fila.diagnostico_tecnico).toContain("corrosion")
    expect(fila.presentado_ante).toBe("La Segunda ART")
  })

  it("deja el documento en total cero cuando no hay items", async () => {
    mockAuthSuccess()

    await POST(createPostRequest({ clienteId: "cli-1", items: [], ...DICTAMEN }))

    const fila = cotizaciones.insert.mock.calls[0][0]
    expect(fila.subtotal).toBe(0)
    expect(fila.iva).toBe(0)
    expect(fila.total).toBe(0)
  })

  it("rechaza cero items sin veredicto", async () => {
    mockAuthSuccess()

    const res = await POST(createPostRequest({ clienteId: "cli-1", items: [] }))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toContain("veredicto")
  })

  it("rechaza cero items con veredicto REPARABLE", async () => {
    mockAuthSuccess()

    const res = await POST(
      createPostRequest({ clienteId: "cli-1", items: [], ...DICTAMEN, veredicto: "REPARABLE" })
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toContain("al menos un ítem")
  })

  it("sigue guardando el dictamen cuando ademas hay items", async () => {
    mockAuthSuccess()

    await POST(
      createPostRequest({
        clienteId: "cli-1",
        items: [{ descripcion: "Cambio de pantalla", cantidad: 1, precioUnitario: 50000 }],
        veredicto: "REPARABLE",
        diagnosticoTecnico: "Pantalla rota por caida.",
        causaDano: "CAIDA",
      })
    )

    const fila = cotizaciones.insert.mock.calls[0][0]
    expect(fila.veredicto).toBe("REPARABLE")
    expect(fila.causa_dano).toBe("CAIDA")
  })

  it("deja las columnas nuevas en null cuando no se mandan", async () => {
    mockAuthSuccess()

    await POST(
      createPostRequest({
        clienteId: "cli-1",
        items: [{ descripcion: "Mano de obra", cantidad: 1, precioUnitario: 8000 }],
      })
    )

    const fila = cotizaciones.insert.mock.calls[0][0]
    expect(fila.veredicto).toBeNull()
    expect(fila.diagnostico_tecnico).toBeNull()
    expect(fila.causa_dano).toBeNull()
    expect(fila.presentado_ante).toBeNull()
  })
})

describe("GET /api/cotizaciones/[id] — DTO del dictamen", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 1, error: null } as any)
  })

  it("expone el dictamen en camelCase", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      cotizaciones: createChainMock({
        id: "cot-1",
        organization_id: "org-1",
        estado: "ENVIADA",
        veredicto: "IRREPARABLE",
        diagnostico_tecnico: "Sin reparacion posible.",
        causa_dano: "LIQUIDO",
        presentado_ante: "La Segunda ART",
        items_cotizacion: [],
      }),
    })

    const res = await getCotizacion(
      new Request("http://localhost/api/cotizaciones/cot-1") as any,
      { params: Promise.resolve({ id: "cot-1" }) }
    )
    const { status, body } = await parseResponse(res)

    expect(body.veredicto).toBe("IRREPARABLE")
    expect(body.diagnosticoTecnico).toBe("Sin reparacion posible.")
    expect(body.causaDano).toBe("LIQUIDO")
    expect(body.presentadoAnte).toBe("La Segunda ART")
  })
})
