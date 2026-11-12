// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockSupabaseFrom,
  createChainMock,
  createPostRequest,
  parseResponse,
} from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/subscriptions", () => ({ hasPlanFeature: vi.fn().mockResolvedValue(true) }))
vi.mock("@/lib/operadores", () => ({ resolveOperador: vi.fn().mockResolvedValue(null) }))
vi.mock("@/lib/audit", () => ({ createAuditLogger: () => ({ create: vi.fn() }) }))
vi.mock("@/lib/webhooks/dispatcher", () => ({ emitWebhookEvent: vi.fn().mockResolvedValue(undefined) }))

import { idsConLineasNuevas, rechazarItemsEnDivisa } from "@/lib/currency/bloqueo-divisa.server"
import { POST as postVenta } from "@/app/api/ventas/route"
import { PUT as putVenta } from "@/app/api/ventas/[id]/route"
import { POST as postRepuesto } from "@/app/api/ordenes/[id]/repuestos/route"
import { POST as postServicio } from "@/app/api/ordenes/[id]/servicios/route"
import { POST as postCotizacion } from "@/app/api/cotizaciones/route"
import { PUT as putCotizacion } from "@/app/api/cotizaciones/[id]/route"

const usd = { id: "x-1", nombre: "Pantalla OLED", moneda: "USD" }
const local = { id: "x-2", nombre: "Cable", moneda: null }

beforeEach(() => {
  vi.clearAllMocks()
  mockAuthSuccess()
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { success: true }, error: null } as any)
})

describe("rechazarItemsEnDivisa", () => {
  it("sin ids no consulta y devuelve null", async () => {
    const res = await rechazarItemsEnDivisa({ organizationId: "org-1", inventarioIds: [null, undefined, ""], servicioIds: [] })
    expect(res).toBeNull()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it("ítem local: null", async () => {
    mockSupabaseFrom({ inventario: createChainMock([local]) })
    expect(await rechazarItemsEnDivisa({ organizationId: "org-1", inventarioIds: ["x-2", "x-2"] })).toBeNull()
  })

  it("ítem en USD: 409 con code y mensaje", async () => {
    const inv = createChainMock([local, usd])
    mockSupabaseFrom({ inventario: inv })
    const res = await rechazarItemsEnDivisa({ organizationId: "org-1", inventarioIds: ["x-2", "x-1"] })
    const { status, body } = await parseResponse(res!)
    expect(status).toBe(409)
    expect(body.code).toBe("ITEM_EN_DIVISA")
    expect(body.error).toContain("tiene precio en USD")
    expect(body.error).toContain("Pantalla OLED")
    expect(inv.in).toHaveBeenCalledWith("id", ["x-2", "x-1"])
    expect(inv.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("servicio en EUR: 409", async () => {
    mockSupabaseFrom({ servicios: createChainMock([{ id: "s", nombre: "Soporte", moneda: "EUR" }]) })
    const res = await rechazarItemsEnDivisa({ organizationId: "org-1", servicioIds: ["s"] })
    expect(res!.status).toBe(409)
  })

  it("columna inexistente (42703): null", async () => {
    mockSupabaseFrom({ inventario: createChainMock(null, { code: "42703", message: "no column" }) })
    expect(await rechazarItemsEnDivisa({ organizationId: "org-1", inventarioIds: ["x-1"] })).toBeNull()
  })

  it("otro error: lanza", async () => {
    mockSupabaseFrom({ inventario: createChainMock(null, { code: "XX000", message: "boom" }) })
    await expect(rechazarItemsEnDivisa({ organizationId: "org-1", inventarioIds: ["x-1"] })).rejects.toBeTruthy()
  })
})

describe("idsConLineasNuevas", () => {
  it("devuelve los ids con más líneas pedidas que guardadas", () => {
    expect(idsConLineasNuevas(["a", "a", "b", "c", null, ""], ["a", "b", "b", null])).toEqual(["a", "c"])
  })
  it("sin líneas nuevas: vacío", () => {
    expect(idsConLineasNuevas(["a", "b"], ["a", "b", "b"])).toEqual([])
    expect(idsConLineasNuevas(undefined, ["a"])).toEqual([])
  })
})

describe("rutas: ítems en divisa", () => {
  it("POST /api/ventas: 409 y sin RPC", async () => {
    mockSupabaseFrom({ clientes: createChainMock({ id: "c" }), inventario: createChainMock([usd]) })
    const res = await postVenta(
      createPostRequest({
        clienteNombre: "Consumidor Final",
        items: [{ inventarioId: "x-1", descripcion: "Pantalla", cantidad: 1, precioUnitario: 50 }],
        metodoPago: "EFECTIVO",
        pagos: [{ metodo: "EFECTIVO", monto: 50 }],
      })
    )
    const { status, body } = await parseResponse(res)
    expect(status).toBe(409)
    expect(body.code).toBe("ITEM_EN_DIVISA")
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("POST repuestos de orden (inventario): 409 y sin add_repuesto_inventario", async () => {
    mockSupabaseFrom({
      ordenes_servicio: createChainMock({ id: "o1" }),
      inventario: createChainMock({ id: "x-1", nombre: "Pantalla OLED", moneda: "USD" }),
    })
    const res = await postRepuesto(
      createPostRequest({ tipo: "inventario", inventarioId: "x-1", cantidad: 1 }),
      { params: Promise.resolve({ id: "o1" }) }
    )
    const { status, body } = await parseResponse(res)
    expect(status).toBe(409)
    expect(body.code).toBe("ITEM_EN_DIVISA")
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("POST servicios de orden (catálogo): 409 y sin RPC", async () => {
    mockSupabaseFrom({
      ordenes_servicio: createChainMock({ id: "o1" }),
      servicios: createChainMock({ id: "s-1", nombre: "Soporte", precio: 10, moneda: "USD" }),
    })
    const res = await postServicio(
      createPostRequest({ tipo: "catalogo", servicioId: "s-1", cantidad: 1 }),
      { params: Promise.resolve({ id: "o1" }) }
    )
    const { status, body } = await parseResponse(res)
    expect(status).toBe(409)
    expect(body.code).toBe("ITEM_EN_DIVISA")
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("POST /api/cotizaciones con servicio en USD: 409 sin insertar", async () => {
    const cot = createChainMock({ id: "cot-1" })
    mockSupabaseFrom({
      clientes: createChainMock({ id: "cli-1" }),
      organizations: createChainMock({ zona_horaria: "America/Argentina/Buenos_Aires" }),
      cotizaciones: cot,
      servicios: createChainMock([{ id: "s-1", nombre: "Soporte", moneda: "USD" }]),
    })
    const res = await postCotizacion(
      createPostRequest({
        clienteId: "cli-1",
        items: [{ descripcion: "Soporte", cantidad: 1, precioUnitario: 10, unidad: "Servicio", servicioId: "s-1" }],
      })
    )
    const { status, body } = await parseResponse(res)
    expect(status).toBe(409)
    expect(body.code).toBe("ITEM_EN_DIVISA")
    expect(cot.insert).not.toHaveBeenCalled()
  })
})

describe("PUT /api/cotizaciones/[id]: solo líneas nuevas", () => {
  const params = { params: Promise.resolve({ id: "cot-1" }) }
  function montar() {
    const items = createChainMock([{ id: "it-1", descripcion: "Pantalla", costo_unitario: 1, inventario_id: "x-1", servicio_id: null }])
    const inv = createChainMock([usd])
    mockSupabaseFrom({
      cotizaciones: createChainMock({ id: "cot-1", estado: "BORRADOR", organization_id: "org-1", items_cotizacion: [{ id: "it-1" }] }),
      items_cotizacion: items,
      inventario: inv,
    })
    return { items, inv }
  }
  const linea = (inventarioId: string, extra: object = {}) => ({
    descripcion: "Pantalla", cantidad: 1, precioUnitario: 100, unidad: "Unidad", inventarioId, ...extra,
  })

  it("mantener una línea existente cuyo ítem pasó a USD no bloquea", async () => {
    const { inv } = montar()
    const res = await putCotizacion(createPostRequest({ items: [linea("x-1", { id: "it-1" })] }), params)
    expect(res.status).not.toBe(409)
    expect(inv.in).not.toHaveBeenCalled()
  })

  it("agregar una segunda línea de un ítem ya guardado que pasó a USD: 409", async () => {
    const { inv } = montar()
    const res = await putCotizacion(
      createPostRequest({ items: [linea("x-1", { id: "it-1" }), linea("x-1", { descripcion: "Pantalla 2" })] }),
      params
    )
    const { status, body } = await parseResponse(res)
    expect(status).toBe(409)
    expect(body.code).toBe("ITEM_EN_DIVISA")
    expect(inv.in).toHaveBeenCalledWith("id", ["x-1"])
  })

  it("agregar una línea nueva en USD: 409", async () => {
    montar()
    const res = await putCotizacion(
      createPostRequest({ items: [linea("x-1", { id: "it-1" }), linea("x-9", { descripcion: "Otra" })] }),
      params
    )
    const { status, body } = await parseResponse(res)
    expect(status).toBe(409)
    expect(body.code).toBe("ITEM_EN_DIVISA")
  })
})

describe("PUT /api/ventas/[id]: solo ítems nuevos", () => {
  const params = { params: Promise.resolve({ id: "v1" }) }
  function montar() {
    const inv = createChainMock([usd])
    mockSupabaseFrom({
      ventas: createChainMock({
        id: "v1", estado: "COMPLETADA", cliente_nombre: "X", total: 100,
        items_venta: [{ id: "l1", inventario_id: "x-1" }], pagos_venta: [],
      }),
      inventario: inv,
    })
    return inv
  }
  const body = (ids: string[]) => ({
    action: "edit",
    clienteNombre: "Cliente",
    items: ids.map((inventarioId) => ({ inventarioId, descripcion: "Pantalla", cantidad: 1, precioUnitario: 100 })),
    descuento: 0, tipoDescuento: "MONTO", porcentajeDescuento: 0, metodoPago: "EFECTIVO",
  })
  const put = (b: object) =>
    putVenta(new Request("http://localhost/api/ventas/v1", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }), params)

  it("mantener una línea guardada cuyo ítem pasó a USD no bloquea", async () => {
    const inv = montar()
    const res = await put(body(["x-1"]))
    expect(res.status).not.toBe(409)
    expect(inv.in).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("editar_venta_atomica", expect.anything())
  })

  it("agregar una segunda línea de un ítem guardado que pasó a USD: 409 y sin RPC", async () => {
    const inv = montar()
    const res = await put(body(["x-1", "x-1"]))
    const { status, body: b } = await parseResponse(res)
    expect(status).toBe(409)
    expect(b.code).toBe("ITEM_EN_DIVISA")
    expect(inv.in).toHaveBeenCalledWith("id", ["x-1"])
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("agregar un ítem nuevo en USD: 409 y sin RPC", async () => {
    montar()
    const res = await put(body(["x-1", "x-9"]))
    const { status, body: b } = await parseResponse(res)
    expect(status).toBe(409)
    expect(b.code).toBe("ITEM_EN_DIVISA")
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })
})
