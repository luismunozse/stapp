import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cookies } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, mockAuthError, createChainMock, createGetRequest, parseResponse } from "./helpers"
import { GET } from "@/app/api/garantias/unificadas/route"

const URL_BASE = "http://localhost/api/garantias/unificadas"
const S1 = "suc-1"

function mockCookie(value: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn((name: string) => (name === "stapp-sucursal-activa" && value ? { value } : undefined)),
    set: vi.fn(),
  } as any)
}

const filaReparacion = {
  id: "g-1", origen: "REPARACION", organization_id: "org-1", sucursal_id: S1, tecnico_id: "tec-1", vendedor_id: null,
  cliente_id: "cli-1", cliente_nombre: "Juan Pérez", cliente_telefono: "1155554444", descripcion: "iPhone 12",
  orden_id: "o-1", numero_orden: 123, codigo_orden: null, orden_estado: "ENTREGADO", venta_id: null, numero_venta: null,
  numero_garantia: null, referencia: "123", dias_validez: 30, fecha_inicio: "2026-10-15T12:00:00Z",
  fecha_vencimiento: "2026-11-14T12:00:00Z", dia_vencimiento: "2026-11-14", estado_guardado: "ACTIVA",
  anulada: false, tiene_reclamo_abierto: false,
}

const filaVenta = {
  ...filaReparacion,
  id: "gv-1", origen: "VENTA", tecnico_id: null, vendedor_id: "vend-otro", descripcion: "Cargador USB-C",
  orden_id: null, numero_orden: null, orden_estado: null, venta_id: "v-1", numero_venta: 12,
  numero_garantia: "GV-0007", referencia: "12",
}

/** Cada from("v_garantias") es una consulta: [0] la lista, [1..4] los conteos por pestaña. */
function setup(opts: { filas?: unknown[]; total?: number; conteos?: number[]; vistaError?: unknown; zona?: string } = {}) {
  const vistas: ReturnType<typeof createChainMock>[] = []
  const conteos = opts.conteos ?? [3, 1, 9, 4]
  vi.mocked(supabaseAdmin.from).mockImplementation((t: string) => {
    if (t === "v_garantias") {
      const i = vistas.length
      const chain =
        i === 0
          ? createChainMock(opts.filas ?? [filaReparacion], opts.vistaError ?? null, opts.total ?? 3)
          : createChainMock(null, null, conteos[i - 1])
      vistas.push(chain)
      return chain as any
    }
    if (t === "organizations") {
      return createChainMock({ zona_horaria: opts.zona ?? "America/Argentina/Buenos_Aires", pais: "AR", nombre: "Taller", nombre_mostrar: "Taller Sur" }) as any
    }
    if (t === "sucursales") return createChainMock([{ id: S1, nombre: "Centro" }]) as any
    return createChainMock([]) as any
  })
  return vistas
}

const get = (qs = "") => GET(createGetRequest(`${URL_BASE}${qs}`))

describe("GET /api/garantias/unificadas — acceso y alcance", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookie(null)
  })

  it("sin sesión responde 401 y no lee la vista", async () => {
    mockAuthError()
    const res = await get()
    expect(res.status).toBe(401)
    expect(supabaseAdmin.from).not.toHaveBeenCalledWith("v_garantias")
  })

  it("toda consulta va acotada a la organización", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const vistas = setup()
    await get()
    expect(vistas).toHaveLength(5)
    for (const v of vistas) expect(v.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("ADMIN sin sucursal elegida: toda la org", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const vistas = setup()
    const res = await parseResponse(await get())
    for (const v of vistas) {
      expect(v.eq).not.toHaveBeenCalledWith("sucursal_id", expect.anything())
      expect(v.or).not.toHaveBeenCalledWith(expect.stringContaining("tecnico_id"), expect.anything())
    }
    expect(res.body.sucursal).toBe("todas")
  })

  it("ADMIN con sucursal en el selector global: esa sucursal", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie(S1)
    const vistas = setup()
    await get()
    for (const v of vistas) expect(v.eq).toHaveBeenCalledWith("sucursal_id", S1)
  })

  it("ADMIN con ?sucursal=todas (link del dashboard) ignora el selector global", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie(S1)
    const vistas = setup()
    await get("?sucursal=todas")
    for (const v of vistas) expect(v.eq).not.toHaveBeenCalledWith("sucursal_id", expect.anything())
  })

  it("VENDEDOR: su sucursal, aunque pida otra o todas por la URL", async () => {
    mockAuthSuccess({ role: "VENDEDOR", sucursalId: S1 })
    const vistas = setup()
    const res = await parseResponse(await get("?sucursal=todas"))
    for (const v of vistas) {
      expect(v.eq).toHaveBeenCalledWith("sucursal_id", S1)
      expect(v.eq).not.toHaveBeenCalledWith("origen", "REPARACION")
    }
    expect(res.body.soloLectura).toBe(false)
  })

  it("TECNICO: solo reparación, de su sucursal o asignadas, en solo lectura", async () => {
    mockAuthSuccess({ role: "TECNICO", sucursalId: S1, userId: "tec-1" })
    const vistas = setup()
    const res = await parseResponse(await get())
    for (const v of vistas) {
      expect(v.eq).toHaveBeenCalledWith("origen", "REPARACION")
      expect(v.or).toHaveBeenCalledWith(`sucursal_id.eq.${S1},tecnico_id.eq.tec-1`, undefined)
    }
    expect(res.body.soloLectura).toBe(true)
    const acc = res.body.data[0].acciones
    expect(acc.reclamoHref).toBeNull()
    expect(acc.whatsappUrl).toBeNull()
    expect(acc.verHref).toBe("/ordenes/o-1")
    // Asignada a él: puede bajar el comprobante.
    expect(acc.certificadoUrl).toBe("/api/ordenes/o-1/comprobante-entrega")
  })

  it("VENDEDOR sin sucursal: el centinela que no matchea nada (fail-closed)", async () => {
    mockAuthSuccess({ role: "VENDEDOR", sucursalId: null })
    const vistas = setup()
    await get()
    expect(vistas[0].eq).toHaveBeenCalledWith("sucursal_id", expect.not.stringMatching(/^suc-/))
  })
})

describe("GET /api/garantias/unificadas — pestañas por día de la org", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookie(null)
    mockAuthSuccess({ role: "ADMIN" })
    vi.useFakeTimers({ toFake: ["Date"] })
    // 23:30 del 11/11 en Argentina = 02:30 del 12/11 en UTC.
    vi.setSystemTime(new Date("2026-11-12T02:30:00Z"))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("por vencer: hoy..hoy+7 en la zona de la org, sin anuladas ni reclamadas", async () => {
    const vistas = setup()
    const res = await parseResponse(await get("?tab=por-vencer"))
    const lista = vistas[0]
    expect(lista.gte).toHaveBeenCalledWith("dia_vencimiento", "2026-11-11")
    expect(lista.lte).toHaveBeenCalledWith("dia_vencimiento", "2026-11-18")
    expect(lista.eq).toHaveBeenCalledWith("anulada", false)
    expect(lista.eq).toHaveBeenCalledWith("tiene_reclamo_abierto", false)
    expect(lista.order).toHaveBeenNthCalledWith(1, "dia_vencimiento", { ascending: true })
    expect(res.body.hoy).toBe("2026-11-11")
    expect(res.body.data[0]).toMatchObject({ estado: "POR_VENCER", diasRestantes: 3 })
  })

  it("en otra zona horaria, otro hoy", async () => {
    const vistas = setup({ zona: "Europe/Madrid" })
    await get("?tab=por-vencer")
    expect(vistas[0].gte).toHaveBeenCalledWith("dia_vencimiento", "2026-11-12")
  })

  it("la ventana es un parámetro", async () => {
    const vistas = setup()
    await get("?tab=por-vencer&ventana=30")
    expect(vistas[0].lte).toHaveBeenCalledWith("dia_vencimiento", "2026-12-11")
  })

  it("vigentes: después de la ventana", async () => {
    const vistas = setup()
    await get("?tab=vigentes")
    expect(vistas[0].gt).toHaveBeenCalledWith("dia_vencimiento", "2026-11-18")
  })

  it("reclamos abiertos", async () => {
    const vistas = setup()
    await get("?tab=reclamos")
    expect(vistas[0].eq).toHaveBeenCalledWith("tiene_reclamo_abierto", true)
    expect(vistas[0].eq).toHaveBeenCalledWith("anulada", false)
  })

  it("vencidas y anuladas: antes de hoy (sin reclamo abierto) o anuladas; la más reciente primero", async () => {
    const vistas = setup()
    await get("?tab=vencidas")
    expect(vistas[0].or).toHaveBeenCalledWith("anulada.is.true,and(tiene_reclamo_abierto.is.false,dia_vencimiento.lt.2026-11-11)")
    expect(vistas[0].order).toHaveBeenNthCalledWith(1, "dia_vencimiento", { ascending: false })
  })

  it("devuelve el conteo de cada pestaña; el de la pestaña abierta es el total de la lista", async () => {
    setup({ total: 3, conteos: [99, 1, 9, 4] })
    const res = await parseResponse(await get("?tab=por-vencer"))
    expect(res.body.conteos).toEqual({ "por-vencer": 3, reclamos: 1, vigentes: 9, vencidas: 4 })
    expect(res.body.total).toBe(3)
  })

  it("filtra por origen y busca por cliente, orden, venta o certificado", async () => {
    const vistas = setup()
    await get("?origen=VENTA&q=%23123")
    for (const v of vistas) {
      expect(v.eq).toHaveBeenCalledWith("origen", "VENTA")
      const filtro = v.or.mock.calls.map((c) => String(c[0])).find((f) => f.includes("ilike")) ?? ""
      expect(filtro).toContain("cliente_nombre.ilike.%#123%")
      expect(filtro).toContain("numero_garantia.ilike.%#123%")
      expect(filtro).toContain("referencia.eq.123")
    }
  })

  it("la búsqueda no puede abrir una cláusula nueva en el filtro", async () => {
    const vistas = setup()
    await get("?q=" + encodeURIComponent("x),organization_id.eq.otra"))
    const filtro = vistas[0].or.mock.calls.map((c) => String(c[0])).find((f) => f.includes("ilike")) ?? ""
    expect(filtro).toContain("cliente_nombre.ilike")
    expect(filtro).not.toContain("),organization_id")
  })

  it("pagina con range", async () => {
    const vistas = setup({ total: 41 })
    const res = await parseResponse(await get("?page=3&limit=20"))
    expect(vistas[0].range).toHaveBeenCalledWith(40, 59)
    expect(res.body).toMatchObject({ page: 3, limit: 20, totalPages: 3 })
  })

  it("un error de la vista responde 500", async () => {
    setup({ vistaError: { code: "42P01", message: "no existe" } })
    const res = await get()
    expect(res.status).toBe(500)
  })
})

describe("GET /api/garantias/unificadas — acciones de cada fila", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookie(null)
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-11T15:00:00Z"))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("reparación vigente para ADMIN: ver orden, comprobante, WhatsApp y registrar reclamo", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    setup()
    const res = await parseResponse(await get())
    const g = res.body.data[0]
    expect(g).toMatchObject({
      origen: "REPARACION",
      cliente: { nombre: "Juan Pérez" },
      descripcion: "iPhone 12",
      referencia: { tipo: "ORDEN", id: "o-1", numero: "#123" },
      sucursal: { id: S1, nombre: "Centro" },
    })
    expect(g.acciones.verHref).toBe("/ordenes/o-1")
    expect(g.acciones.reclamoHref).toBe("/ordenes/o-1")
    expect(g.acciones.certificadoUrl).toBe("/api/ordenes/o-1/comprobante-entrega")
    expect(g.acciones.whatsappUrl).toMatch(/^https:\/\/wa\.me\/\d+\?text=/)
    expect(decodeURIComponent(g.acciones.whatsappUrl)).toContain("Hola Juan Pérez, te escribimos de Taller Sur")
  })

  it("venta: el ADMIN ve la venta y el certificado PDF existente", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    setup({ filas: [filaVenta] })
    const res = await parseResponse(await get())
    const g = res.body.data[0]
    expect(g.referencia).toEqual({ tipo: "VENTA", id: "v-1", numero: "V0012" })
    expect(g.numeroGarantia).toBe("GV-0007")
    expect(g.acciones.verHref).toBe("/ventas/v-1")
    expect(g.acciones.certificadoUrl).toBe("/api/ventas/v-1/garantia/gv-1/pdf")
    expect(g.acciones.reclamoHref).toBeNull()
  })

  it("venta de otro vendedor: el VENDEDOR no tiene link ni certificado (la venta le daría 404)", async () => {
    mockAuthSuccess({ role: "VENDEDOR", sucursalId: S1, userId: "vend-1" })
    setup({ filas: [filaVenta, { ...filaVenta, id: "gv-2", vendedor_id: "vend-1" }] })
    const res = await parseResponse(await get())
    expect(res.body.data[0].acciones.verHref).toBeNull()
    expect(res.body.data[0].acciones.certificadoUrl).toBeNull()
    expect(res.body.data[0].acciones.whatsappUrl).not.toBeNull()
    expect(res.body.data[1].acciones.verHref).toBe("/ventas/v-1")
  })

  it("anulada: sin certificado ni WhatsApp", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    setup({ filas: [{ ...filaVenta, anulada: true }] })
    const res = await parseResponse(await get("?tab=vencidas"))
    const g = res.body.data[0]
    expect(g.estado).toBe("ANULADA")
    expect(g.acciones.certificadoUrl).toBeNull()
    expect(g.acciones.whatsappUrl).toBeNull()
  })

  it("TECNICO sobre una orden que no es suya: sin comprobante", async () => {
    mockAuthSuccess({ role: "TECNICO", sucursalId: S1, userId: "tec-2" })
    setup()
    const res = await parseResponse(await get())
    expect(res.body.data[0].acciones.certificadoUrl).toBeNull()
  })
})
