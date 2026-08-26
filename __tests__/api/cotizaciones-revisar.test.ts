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

  it("la revision nace con su propio link publico para que el cliente pueda firmarla", async () => {
    // Sin `public_token` la revision no se puede compartir (los botones
    // Compartir/WhatsApp cortan mudos) y las paginas publicas de firma y
    // rechazo son inalcanzables: la revision no se firmaria nunca, que es
    // justamente lo que la revision existe para permitir. La columna no tiene
    // DEFAULT ni trigger (migracion 029) y `enviar` no la escribe, asi que si
    // no sale de aca no sale de ningun lado.
    const cotChain = createChainMock({
      id: "cot-1",
      estado: "ACEPTADA",
      organization_id: "org-1",
      orden_id: "orden-1",
      numero_cotizacion: "COT-0001",
      public_token: "a".repeat(32),
      total: 100,
    })
    mockSupabaseFrom({
      cotizaciones: cotChain,
      items_cotizacion: createChainMock([{ descripcion: "X", cantidad: 1, precio_unitario: 100 }]),
    })

    await call()

    const insertado = cotChain.insert.mock.calls[0][0]
    // 32 hex: el largo exacto que validan las rutas publicas (`token.length !== 32`).
    expect(insertado.public_token).toMatch(/^[0-9a-f]{32}$/)
    // Y es propio: heredar el de la original haria que el link viejo del
    // cliente mostrara la version nueva sin avisar.
    expect(insertado.public_token).not.toBe("a".repeat(32))
  })

  it("no revisa una cotizacion que ya fue reemplazada por otra revision", async () => {
    // Una reemplazada sigue en ACEPTADA a proposito, asi que el guard de estado
    // no la frena. Revisarla otra vez crea una segunda revision sobre la misma
    // original: al aprobarla, la migracion 312 libera las reservas de la
    // original por segunda vez y le come la reserva a otras cotizaciones.
    mockSupabaseFrom({
      cotizaciones: createChainMock({
        id: "cot-1",
        estado: "ACEPTADA",
        organization_id: "org-1",
        reemplazada_por: "rev-1",
        total: 100,
      }),
    })

    const { status, body } = await parseResponse(await call())

    expect(status).toBe(400)
    expect(body.error).toMatch(/reemplazada/i)
  })

  it("excluye de la busqueda las cotizaciones borradas", async () => {
    const cotChain = createChainMock({
      id: "cot-1",
      estado: "ACEPTADA",
      organization_id: "org-1",
      total: 100,
    })
    mockSupabaseFrom({
      cotizaciones: cotChain,
      items_cotizacion: createChainMock([]),
    })

    await call()

    expect(cotChain.is).toHaveBeenCalledWith("deleted_at", null)
  })

  it("una cotizacion de otra organizacion no se puede revisar", async () => {
    mockAuthSuccess({ organizationId: "org-1" })
    // La fila existe, pero es de org-2: el filtro por organizacion la deja
    // fuera y .single() no devuelve nada.
    const cotChain = createChainMock(null, { code: "PGRST116", message: "no rows returned" })
    mockSupabaseFrom({ cotizaciones: cotChain })

    const { status, body } = await parseResponse(await call("cot-de-org-2"))

    expect(status).toBe(404)
    expect(body.error).toBe("Cotización no encontrada")
    // El 404 tiene que venir del scope, no de que la fila no exista: sin este
    // filtro, cualquier taller podria revisar la cotizacion de otro.
    expect(cotChain.eq.mock.calls).toContainEqual(["organization_id", "org-1"])
    expect(cotChain.insert).not.toHaveBeenCalled()
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

  it("al enviarla le asigna una validez, para que el PDF no salga con la fecha en blanco", async () => {
    // La revision nace sin fecha_vencimiento a proposito (heredar la de la
    // original podria crearla ya vencida), pero el cliente recibe el PDF y la
    // pantalla de seguimiento: sin vencimiento le llega un "válida hasta" vacio.
    const cotizacionRow = {
      id: "rev-1",
      estado: "BORRADOR",
      organization_id: "org-1",
      orden_id: null,
      revision_de: "cot-1",
      fecha_vencimiento: null,
      total: 120,
      numero_cotizacion: "COT-0001",
      ordenes_servicio: null,
      clientes: { email: "cliente@test.com", nombre: "Cliente Test", telefono: null, direccion: null },
      sectores_cliente: null,
      items_cotizacion: [],
    }
    const cotChain = createChainMock(cotizacionRow)
    // La validez configurada por la organizacion: 15 dias, no el default de 30,
    // para que el assert distinga "leyo la config" de "puso cualquier cosa".
    const orgChain = createChainMock({ cotizacion_validez_dias: 15 })

    mockSupabaseFrom({ cotizaciones: cotChain, organizations: orgChain })

    const { POST } = await import("@/app/api/cotizaciones/[id]/enviar/route")
    const response = await POST(
      new Request("http://localhost:3000/api/cotizaciones/rev-1/enviar", { method: "POST" }) as any,
      { params: Promise.resolve({ id: "rev-1" }) } as any
    )

    expect(response.status).toBe(200)

    const conVencimiento = cotChain.update.mock.calls
      .map((c: any[]) => c[0])
      .find((u: any) => u && "fecha_vencimiento" in u)
    expect(conVencimiento).toBeDefined()

    const dias = Math.round(
      (new Date(conVencimiento.fecha_vencimiento).getTime() - Date.now()) / 86_400_000
    )
    expect(dias).toBe(15)
  })

  it("no le pisa el vencimiento a una revision que ya tiene uno puesto a mano", async () => {
    const vencimientoElegido = new Date("2030-01-01T12:00:00.000Z").toISOString()
    const cotizacionRow = {
      id: "rev-2",
      estado: "BORRADOR",
      organization_id: "org-1",
      orden_id: null,
      revision_de: "cot-1",
      fecha_vencimiento: vencimientoElegido,
      total: 120,
      numero_cotizacion: "COT-0001",
      ordenes_servicio: null,
      clientes: { email: "cliente@test.com", nombre: "Cliente Test", telefono: null, direccion: null },
      sectores_cliente: null,
      items_cotizacion: [],
    }
    const cotChain = createChainMock(cotizacionRow)
    mockSupabaseFrom({ cotizaciones: cotChain, organizations: createChainMock({ cotizacion_validez_dias: 15 }) })

    const { POST } = await import("@/app/api/cotizaciones/[id]/enviar/route")
    const response = await POST(
      new Request("http://localhost:3000/api/cotizaciones/rev-2/enviar", { method: "POST" }) as any,
      { params: Promise.resolve({ id: "rev-2" }) } as any
    )

    expect(response.status).toBe(200)
    const updates = cotChain.update.mock.calls.map((c: any[]) => c[0])
    expect(updates.some((u: any) => u && "fecha_vencimiento" in u)).toBe(false)
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
