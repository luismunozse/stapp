import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockAuthError, createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"

// El envio (Task 5) genera PDF y manda email de verdad si no se mockean: son
// costosos (pdf-lib/fontkit) o pegan a una API externa (Envialosimple). El
// gating de plan tambien es una consulta real a `organizations`/suscripcion
// que no hace falta ejercitar aca.
vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
}))
vi.mock("@/lib/pdf", () => ({
  generateCotizacionPDF: vi.fn().mockResolvedValue(Buffer.from("fake-pdf")),
}))
vi.mock("@/lib/email", () => ({
  sendCotizacionEmail: vi.fn().mockResolvedValue(undefined),
}))

const call = async (id = "cot-1") => {
  const { POST } = await import("@/app/api/cotizaciones/[id]/revisar/route")
  return POST(
    new Request(`http://localhost:3000/api/cotizaciones/${id}/revisar`, { method: "POST" }) as any,
    { params: Promise.resolve({ id }) } as any
  )
}

describe("POST /api/cotizaciones/[id]/revisar", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it("rechaza sin sesion", async () => {
    mockAuthError()
    expect((await parseResponse(await call())).status).toBe(401)
  })

  it("solo revisa cotizaciones ACEPTADAS", async () => {
    mockSupabaseFrom({
      cotizaciones: createChainMock({ id: "cot-1", estado: "BORRADOR", organization_id: "org-1" }),
    })
    const { status } = await parseResponse(await call())
    expect(status).toBe(400)
  })

  it("no toca la cotizacion firmada: solo inserta la revision", async () => {
    const cotChain = createChainMock({
      id: "cot-1",
      estado: "ACEPTADA",
      organization_id: "org-1",
      orden_id: "orden-1",
      numero_cotizacion: "COT-0001",
      firma_aprobacion: "data:image/png;base64,AAA",
      total: 100,
    })
    mockSupabaseFrom({
      cotizaciones: cotChain,
      items_cotizacion: createChainMock([{ descripcion: "X", cantidad: 1, precio_unitario: 100 }]),
    })

    const { status } = await parseResponse(await call())

    expect(status).toBe(201)
    expect(cotChain.update).not.toHaveBeenCalled()
    expect(cotChain.insert).toHaveBeenCalled()
  })

  it("la revision nace en BORRADOR y conserva el numero de la original", async () => {
    const cotChain = createChainMock({
      id: "cot-1",
      estado: "ACEPTADA",
      organization_id: "org-1",
      orden_id: "orden-1",
      numero_cotizacion: "COT-0001",
      notas: "Nota original",
      equipo_snapshot: { dispositivo: "iPhone 12" },
      total: 100,
    })
    mockSupabaseFrom({
      cotizaciones: cotChain,
      items_cotizacion: createChainMock([{ descripcion: "X", cantidad: 1, precio_unitario: 100 }]),
    })

    await call()

    const insertado = cotChain.insert.mock.calls[0][0]
    expect(insertado).toEqual(
      expect.objectContaining({
        estado: "BORRADOR",
        numero_cotizacion: "COT-0001",
        orden_id: "orden-1",
        notas: "Nota original",
        equipo_snapshot: { dispositivo: "iPhone 12" },
      })
    )
    // La firma es de la original y no se hereda: la revision se firma de nuevo.
    expect(insertado.firma_aprobacion ?? null).toBeNull()
  })

  it("la revision de un presupuesto sigue siendo un presupuesto", async () => {
    const cotChain = createChainMock({
      id: "cot-1",
      estado: "ACEPTADA",
      organization_id: "org-1",
      orden_id: null,
      numero_cotizacion: "COT-0002",
      tipo: "PRESUPUESTO",
      total: 100,
    })
    mockSupabaseFrom({
      cotizaciones: cotChain,
      items_cotizacion: createChainMock([{ descripcion: "X", cantidad: 1, precio_unitario: 100 }]),
    })

    await call()

    const insertado = cotChain.insert.mock.calls[0][0]
    expect(insertado.tipo).toBe("PRESUPUESTO")
  })
})

describe("POST /api/cotizaciones/[id]/enviar — revision reemplaza a la original", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it("al enviar la revision, marca la original como reemplazada antes de recalcular el presupuesto", async () => {
    // "cotizaciones" atiende dos consultas de forma distinta en este mismo
    // POST: la que trae la fila enviada (usa .single(), necesita un objeto)
    // y la que suma las vigentes para el recalculo del presupuesto de la
    // orden (no usa .single(), necesita un array de {total}). Igual que en
    // cotizaciones-presupuesto-recalc.test.ts, se pisa .single() para separar
    // ambos casos sin tocar el resto del chain.
    const cotizacionRow = {
      id: "rev-1",
      estado: "BORRADOR",
      organization_id: "org-1",
      orden_id: "orden-1",
      revision_de: "cot-1",
      total: 120,
      numero_cotizacion: "COT-0001",
      // El join real trae la orden con su cliente y organizacion adentro;
      // sin esto la ruta corta antes con "cliente sin email".
      ordenes_servicio: {
        id: "orden-1",
        numero_orden: "ORD-0001",
        dispositivo: "iPhone 12",
        problema_reportado: "Pantalla rota",
        organization_id: "org-1",
        clientes: { email: "cliente@test.com", nombre: "Cliente Test", telefono: null, direccion: null },
        organizations: {
          id: "org-1", nombre_mostrar: "Taller Test", telefono: null, direccion: null,
          logo_url: null, moneda: "ARS", zona_horaria: "America/Argentina/Buenos_Aires",
        },
      },
      clientes: null,
      sectores_cliente: null,
      items_cotizacion: [],
    }
    const cotizacionesChain = createChainMock([{ total: 120 }])
    cotizacionesChain.single = vi.fn().mockResolvedValue({ data: cotizacionRow, error: null })

    // RECIBIDO es un estado valido para que la ruta dispare el recalculo del
    // presupuesto de la orden: es la ventana donde el orden de escritura
    // realmente importa.
    const ordenesChain = createChainMock({ id: "orden-1", estado: "RECIBIDO" })

    mockSupabaseFrom({
      cotizaciones: cotizacionesChain,
      ordenes_servicio: ordenesChain,
      orden_eventos: createChainMock(null),
    })

    const { POST } = await import("@/app/api/cotizaciones/[id]/enviar/route")
    const response = await POST(
      new Request("http://localhost:3000/api/cotizaciones/rev-1/enviar", { method: "POST" }) as any,
      { params: Promise.resolve({ id: "rev-1" }) } as any
    )

    // Sanity: si esto no es 200, el resto de los asserts no dice nada (la
    // ruta pudo haber cortado antes por otro motivo).
    expect(response.status).toBe(200)

    const marcaIdx = cotizacionesChain.update.mock.calls.findIndex(
      (c: any[]) => c[0]?.reemplazada_por === "rev-1"
    )
    expect(marcaIdx).toBeGreaterThanOrEqual(0)

    const recalculoIdx = ordenesChain.update.mock.calls.findIndex(
      (c: any[]) => c[0] && "presupuesto" in c[0]
    )
    expect(recalculoIdx).toBeGreaterThanOrEqual(0)

    // El corazon de la tarea: si la marca llega despues del recalculo, el
    // presupuesto de la orden cuenta la aceptada Y su revision.
    const ordenMarca = cotizacionesChain.update.mock.invocationCallOrder[marcaIdx]
    const ordenRecalculo = ordenesChain.update.mock.invocationCallOrder[recalculoIdx]
    expect(ordenMarca).toBeLessThan(ordenRecalculo)
  })

  it("una cotizacion normal (sin revision_de) no toca reemplazada_por de nadie", async () => {
    const cotizacionRow = {
      id: "cot-9",
      estado: "BORRADOR",
      organization_id: "org-1",
      orden_id: null,
      revision_de: null,
      total: 50,
      numero_cotizacion: "COT-0009",
      ordenes_servicio: null,
      clientes: { email: "cliente@test.com", nombre: "Cliente Test", telefono: null, direccion: null },
      sectores_cliente: null,
      items_cotizacion: [],
    }
    const cotChain = createChainMock(cotizacionRow)
    mockSupabaseFrom({ cotizaciones: cotChain })

    const { POST } = await import("@/app/api/cotizaciones/[id]/enviar/route")
    const response = await POST(
      new Request("http://localhost:3000/api/cotizaciones/cot-9/enviar", { method: "POST" }) as any,
      { params: Promise.resolve({ id: "cot-9" }) } as any
    )

    expect(response.status).toBe(200)
    const updates = cotChain.update.mock.calls.map((c: any[]) => c[0])
    expect(updates.some((u: any) => u && "reemplazada_por" in u)).toBe(false)
  })
})
