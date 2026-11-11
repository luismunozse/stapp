import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createChainMock } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/public-token", () => ({
  getOrderByPublicToken: vi.fn(async () => ({ orden: { id: "ord-1", organization_id: "org-1" }, error: null })),
}))

import { GET } from "@/app/api/public/ordenes/[token]/warranty/route"
import { reclamoPublico, elegirReclamoPublico } from "@/lib/garantias/seguimiento-publico"

const TOKEN = "a".repeat(32)

const GARANTIA = {
  id: "g-1",
  dias_validez: 90,
  fecha_inicio: "2026-09-01T12:00:00Z",
  fecha_vencimiento: "2026-11-30T12:00:00Z",
  estado: "ACTIVA",
  notas: "Alcance: Solo repuesto.",
}

// Filas como las devolvería un SELECT * descuidado: todo lo interno que NO puede salir.
const RECLAMO_INTERNO = {
  id: "rec-1",
  garantia_id: "g-1",
  descripcion: "Cliente dice que se mojó (nota interna)",
  resolucion: "Nota interna del técnico",
  registrado_por: "user-7",
  decidido_por: "user-1",
  vigencia_forzada_motivo: "Cliente VIP",
  fecha_decision: "2026-11-05T10:00:00Z",
  motivo_rechazo: null,
  fecha_reclamo: "2026-11-04T10:00:00Z",
  orden_reingreso_id: "ord-2",
}

function mockDb(reclamos: Record<string, unknown>[], org: Record<string, unknown> = {}) {
  const pedidos: Record<string, ReturnType<typeof createChainMock>[]> = {}
  vi.mocked(supabaseAdmin.from).mockImplementation((t: string) => {
    let c
    if (t === "garantias") c = createChainMock(GARANTIA)
    else if (t === "organizations")
      c = createChainMock({ zona_horaria: "America/Argentina/Buenos_Aires", garantia_terminos: "No cubre golpes.", ...org })
    else if (t === "reclamos_garantia") c = createChainMock(reclamos)
    else if (t === "ordenes_servicio") c = createChainMock({ numero_orden: 77, codigo_orden: null })
    else c = createChainMock(null)
    ;(pedidos[t] ??= []).push(c)
    return c as any
  })
  return pedidos
}

async function pedir() {
  const res = await GET(new Request(`http://localhost/api/public/ordenes/${TOKEN}/warranty`), {
    params: Promise.resolve({ token: TOKEN }),
  })
  return { status: res.status, body: await res.json() }
}

describe("GET /api/public/ordenes/[token]/warranty", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-11T15:00:00Z"))
  })
  afterEach(() => vi.useRealTimers())

  it("devuelve solo la lista blanca: nada interno del reclamo ni de la garantía", async () => {
    const pedidos = mockDb([{ ...RECLAMO_INTERNO, estado: "ACEPTADO" }])
    const { status, body } = await pedir()
    expect(status).toBe(200)
    expect(Object.keys(body.garantia).sort()).toEqual(
      ["diasRestantes", "diasValidez", "estado", "fechaInicio", "fechaVencimiento", "notas", "reclamo", "terminos"].sort()
    )
    expect(Object.keys(body.garantia.reclamo).sort()).toEqual(["detalle", "fase", "fecha", "ordenReingreso", "titulo"].sort())
    const json = JSON.stringify(body)
    for (const prohibido of ["user-7", "user-1", "Cliente VIP", "nota interna", "Nota interna", "rec-1", "g-1", "ord-2", "org-1"]) {
      expect(json).not.toContain(prohibido)
    }
    // Y ni siquiera se piden: el SELECT del reclamo es explícito.
    const select = pedidos.reclamos_garantia[0].select.mock.calls[0][0] as string
    for (const col of ["registrado_por", "decidido_por", "vigencia_forzada_motivo", "resolucion", "descripcion"]) {
      expect(select).not.toContain(col)
    }
  })

  it("acota todas las lecturas a la organización de la orden", async () => {
    const pedidos = mockDb([{ ...RECLAMO_INTERNO, estado: "ACEPTADO" }])
    await pedir()
    expect(pedidos.garantias[0].eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(pedidos.reclamos_garantia[0].eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(pedidos.ordenes_servicio[0].eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("reclamo aceptado: el cliente ve el número de la orden de re-ingreso", async () => {
    mockDb([{ ...RECLAMO_INTERNO, estado: "ACEPTADO" }])
    const { body } = await pedir()
    expect(body.garantia.estado).toBe("RECLAMADA")
    expect(body.garantia.reclamo).toMatchObject({
      fase: "ACEPTADO",
      titulo: "Aceptado: tu equipo reingresó como orden #77",
      ordenReingreso: "#77",
    })
    expect(body.garantia.terminos).toBe("No cubre golpes.")
  })

  it("reclamo abierto: en revisión", async () => {
    mockDb([{ ...RECLAMO_INTERNO, estado: "PENDIENTE", orden_reingreso_id: null }])
    const { body } = await pedir()
    expect(body.garantia.reclamo.titulo).toBe("Tu reclamo de garantía está en revisión")
    expect(body.garantia.reclamo.ordenReingreso).toBeNull()
  })

  it("sin reclamo, la garantía se deriva con la ventana de la org", async () => {
    mockDb([], { garantia_ventana_por_vencer_dias: 30 })
    const { body } = await pedir()
    expect(body.garantia.reclamo).toBeNull()
    expect(body.garantia.estado).toBe("POR_VENCER")
    expect(body.garantia.diasRestantes).toBe(19)
  })

  it("sin garantía devuelve null", async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation(() => createChainMock(null) as any)
    const { body } = await pedir()
    expect(body).toEqual({ garantia: null })
  })
})

describe("copy del reclamo para el cliente", () => {
  const base = { motivo_rechazo: null, fecha_reclamo: "2026-11-04T10:00:00Z", orden_reingreso_id: null }

  it("rechazado muestra el motivo", () => {
    expect(reclamoPublico({ ...base, estado: "RECHAZADO", motivo_rechazo: "Tiene humedad" }, null).titulo).toBe(
      "Rechazado: Tiene humedad"
    )
  })

  it("resuelto cuenta dónde se hizo la revisión", () => {
    const r = reclamoPublico({ ...base, estado: "RESUELTO" }, "ORD-0077")
    expect(r.fase).toBe("RESUELTO")
    expect(r.detalle).toContain("ORD-0077")
  })

  it("muestra el reclamo abierto aunque haya uno cerrado más nuevo", () => {
    const elegido = elegirReclamoPublico([
      { ...base, estado: "PENDIENTE", fecha_reclamo: "2026-10-01T00:00:00Z" },
      { ...base, estado: "RECHAZADO", fecha_reclamo: "2026-11-01T00:00:00Z" },
    ])
    expect(elegido?.estado).toBe("PENDIENTE")
    expect(
      elegirReclamoPublico([
        { ...base, estado: "RECHAZADO", fecha_reclamo: "2026-10-01T00:00:00Z" },
        { ...base, estado: "RESUELTO", fecha_reclamo: "2026-11-01T00:00:00Z" },
      ])?.estado
    ).toBe("RESUELTO")
  })
})
