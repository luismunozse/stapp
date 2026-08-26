// `cotizaciones.reemplazada_por` (migracion 311) decide que cotizaciones cuentan
// para el presupuesto de la orden: NULL = vigente. Cuando una revision se envia,
// la original queda apuntada y sale de la suma. Cuando la revision MUERE —el
// staff la rechaza, el cliente la rechaza desde el link publico, o alguien la
// borra— la original tiene que volver a ser la vigente.
//
// Si no vuelve, quedan las dos afuera: la revision por RECHAZADA y la original
// por reemplazada. El cambio de estado pelado no recalcula, asi que no rompe
// nada en el momento; pero el proximo recalculo —venga de donde venga— deja
// `presupuesto`/`costo_final` de la orden en 0 o NULL, mientras la firma de la
// original sigue siendo el acuerdo vigente y su stock sigue reservado.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
}))
vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({
    delete: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
  })),
  diffObjects: vi.fn().mockReturnValue({ before: {}, after: {} }),
}))

// La tabla `cotizaciones` atiende tres consultas distintas en estos handlers:
// la fila objetivo (.single()), la suma de vigentes para el recalculo (array de
// {total}) y el UPDATE que restaura el puntero (.select("id") → filas
// afectadas). Un solo array no vacio sirve para las dos ultimas.
function cotChain(fila: any, vigentes: any[] = [{ total: 100 }]) {
  const chain = createChainMock(vigentes)
  chain.single = vi.fn().mockResolvedValue({ data: fila, error: null })
  return chain
}

const revisionEnviada = {
  id: "rev-1",
  estado: "ENVIADA",
  tipo: "ORDEN",
  organization_id: "org-1",
  created_by: "user-1",
  iva_porcentaje: 0,
  descuento_global_tipo: "porcentaje",
  descuento_global_valor: 0,
  orden_id: "orden-1",
  revision_de: "cot-1",
}

function putRechazar(id = "rev-1", body: any = { estado: "RECHAZADA" }) {
  return new Request(`http://localhost:3000/api/cotizaciones/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any
}

describe("PUT /api/cotizaciones/[id] — rechazar una revision devuelve la original", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it("limpia reemplazada_por en la cotizacion que la revision habia reemplazado", async () => {
    const cotizaciones = cotChain(revisionEnviada)
    mockSupabaseFrom({
      cotizaciones,
      ordenes_servicio: createChainMock({ id: "orden-1", estado: "APROBADO" }),
      orden_eventos: createChainMock(null),
    })

    const { PUT } = await import("@/app/api/cotizaciones/[id]/route")
    const res = await PUT(putRechazar(), { params: Promise.resolve({ id: "rev-1" }) } as any)

    expect(res.status).toBe(200)

    const limpieza = cotizaciones.update.mock.calls
      .map((c: any[]) => c[0])
      .find((u: any) => u && "reemplazada_por" in u && u.reemplazada_por === null)
    expect(limpieza).toBeDefined()

    // Solo se limpia el puntero si apunta a ESTA revision: si la original ya
    // fue reemplazada por una revision posterior, esta muerte no la resucita.
    expect(cotizaciones.eq.mock.calls).toContainEqual(["reemplazada_por", "rev-1"])
    expect(cotizaciones.eq.mock.calls).toContainEqual(["id", "cot-1"])
  })

  it("recalcula el presupuesto de la orden para que la cifra restaurada aterrice", async () => {
    // Un cambio pelado de estado no recalcula nada. Sin recalculo, la orden se
    // queda con el numero que tenia; el proximo recalculo por cualquier causa
    // es el que decide, y para entonces nadie relaciona el 0 con este rechazo.
    const cotizaciones = cotChain(revisionEnviada, [{ total: 100 }])
    const ordenes = createChainMock({ id: "orden-1", estado: "APROBADO" })
    mockSupabaseFrom({
      cotizaciones,
      ordenes_servicio: ordenes,
      orden_eventos: createChainMock(null),
    })

    const { PUT } = await import("@/app/api/cotizaciones/[id]/route")
    await PUT(putRechazar(), { params: Promise.resolve({ id: "rev-1" }) } as any)

    expect(ordenes.update.mock.calls.map((c: any[]) => c[0])).toContainEqual(
      expect.objectContaining({ presupuesto: 100, costo_final: 100 })
    )
  })

  it("rechazar una cotizacion normal no toca reemplazada_por ni recalcula", async () => {
    const normal = { ...revisionEnviada, id: "cot-9", revision_de: null }
    const cotizaciones = cotChain(normal)
    const ordenes = createChainMock({ id: "orden-1", estado: "APROBADO" })
    mockSupabaseFrom({
      cotizaciones,
      ordenes_servicio: ordenes,
      orden_eventos: createChainMock(null),
    })

    const { PUT } = await import("@/app/api/cotizaciones/[id]/route")
    await PUT(putRechazar("cot-9"), { params: Promise.resolve({ id: "cot-9" }) } as any)

    const updates = cotizaciones.update.mock.calls.map((c: any[]) => c[0])
    expect(updates.some((u: any) => u && "reemplazada_por" in u)).toBe(false)
    expect(ordenes.update).not.toHaveBeenCalled()
  })
})

describe("PUT /api/cotizaciones/[id] — enviar una revision por link tambien reemplaza", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it("marca la original al pasar la revision a ENVIADA", async () => {
    // "Enviar y compartir" no pasa por /enviar (eso manda el mail): manda
    // `estado: "ENVIADA"` por este PUT. Si la marca solo viviera en /enviar,
    // una revision compartida por link no reemplazaria a su original y la orden
    // contaria las dos versiones.
    const borrador = { ...revisionEnviada, estado: "BORRADOR" }
    const cotizaciones = cotChain(borrador)
    mockSupabaseFrom({
      cotizaciones,
      ordenes_servicio: createChainMock({ id: "orden-1", estado: "APROBADO" }),
      orden_eventos: createChainMock(null),
    })

    const { PUT } = await import("@/app/api/cotizaciones/[id]/route")
    const res = await PUT(
      putRechazar("rev-1", { estado: "ENVIADA" }),
      { params: Promise.resolve({ id: "rev-1" }) } as any
    )

    expect(res.status).toBe(200)
    const marca = cotizaciones.update.mock.calls
      .map((c: any[]) => c[0])
      .find((u: any) => u && u.reemplazada_por === "rev-1")
    expect(marca).toBeDefined()
    expect(cotizaciones.eq.mock.calls).toContainEqual(["id", "cot-1"])
  })
})

describe("DELETE /api/cotizaciones/[id] — borrar una revision devuelve la original", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
  })

  it("limpia reemplazada_por antes de recalcular", async () => {
    const cotizaciones = cotChain(
      { id: "rev-1", estado: "ENVIADA", organization_id: "org-1", orden_id: "orden-1", revision_de: "cot-1" },
      [{ total: 100 }]
    )
    const ordenes = createChainMock([{ id: "orden-1" }])
    ordenes.single = vi.fn().mockResolvedValue({ data: { id: "orden-1", estado: "APROBADO" }, error: null })
    mockSupabaseFrom({ cotizaciones, ordenes_servicio: ordenes, orden_eventos: createChainMock(null) })

    const { DELETE } = await import("@/app/api/cotizaciones/[id]/route")
    const res = await DELETE(
      new Request("http://localhost:3000/api/cotizaciones/rev-1", { method: "DELETE" }) as any,
      { params: Promise.resolve({ id: "rev-1" }) } as any
    )

    expect(res.status).toBe(200)
    const limpieza = cotizaciones.update.mock.calls
      .map((c: any[]) => c[0])
      .find((u: any) => u && "reemplazada_por" in u && u.reemplazada_por === null)
    expect(limpieza).toBeDefined()
    expect(ordenes.update.mock.calls.map((c: any[]) => c[0])).toContainEqual(
      expect.objectContaining({ presupuesto: 100, costo_final: 100 })
    )
  })
})

describe("POST /api/public/cotizaciones/[token]/rechazar — el cliente rechaza la revision", () => {
  beforeEach(() => vi.clearAllMocks())

  const TOKEN = "b".repeat(32)

  it("devuelve la original al presupuesto en vez de dejar la orden en cero", async () => {
    // Este es el camino principal por el que una revision muere: el cliente
    // abre el link, ve el total nuevo y dice que no.
    const cotizaciones = cotChain(
      {
        id: "rev-1",
        estado: "ENVIADA",
        orden_id: "orden-1",
        organization_id: "org-1",
        revision_de: "cot-1",
      },
      [{ total: 100 }]
    )
    const ordenes = createChainMock([{ id: "orden-1" }])
    ordenes.single = vi.fn().mockResolvedValue({ data: { id: "orden-1", estado: "PRESUPUESTADO" }, error: null })
    mockSupabaseFrom({ cotizaciones, ordenes_servicio: ordenes, orden_eventos: createChainMock(null) })

    const { POST } = await import("@/app/api/public/cotizaciones/[token]/rechazar/route")
    const res = await POST(
      new Request(`http://localhost:3000/api/public/cotizaciones/${TOKEN}/rechazar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: "Muy caro" }),
      }) as any,
      { params: Promise.resolve({ token: TOKEN }) } as any
    )

    expect(res.status).toBe(200)

    const limpieza = cotizaciones.update.mock.calls
      .map((c: any[]) => c[0])
      .find((u: any) => u && "reemplazada_por" in u && u.reemplazada_por === null)
    expect(limpieza).toBeDefined()

    const escrituras = ordenes.update.mock.calls.map((c: any[]) => c[0])
    expect(escrituras).toContainEqual(
      expect.objectContaining({ presupuesto: 100, costo_final: 100 })
    )
    // La orden NO perdio su presupuesto: volvio al de la version firmada antes.
    // Revertirla a EN_DIAGNOSTICO seria borrar un acuerdo que sigue vigente.
    expect(escrituras.some((u: any) => u && u.estado === "EN_DIAGNOSTICO")).toBe(false)
  })

  it("una cotizacion comun rechazada sigue revirtiendo la orden a EN_DIAGNOSTICO", async () => {
    // Guarda de no-regresion: el camino nuevo no puede comerse el viejo.
    const cotizaciones = cotChain(
      { id: "cot-9", estado: "ENVIADA", orden_id: "orden-1", organization_id: "org-1", revision_de: null },
      [{ total: 100 }]
    )
    const ordenes = createChainMock([{ id: "orden-1" }])
    ordenes.single = vi.fn().mockResolvedValue({ data: { id: "orden-1", estado: "PRESUPUESTADO" }, error: null })
    mockSupabaseFrom({ cotizaciones, ordenes_servicio: ordenes, orden_eventos: createChainMock(null) })

    const { POST } = await import("@/app/api/public/cotizaciones/[token]/rechazar/route")
    const res = await POST(
      new Request(`http://localhost:3000/api/public/cotizaciones/${TOKEN}/rechazar`, { method: "POST" }) as any,
      { params: Promise.resolve({ token: TOKEN }) } as any
    )

    expect(res.status).toBe(200)
    expect(ordenes.update).toHaveBeenCalledWith({ estado: "EN_DIAGNOSTICO" })
  })
})
