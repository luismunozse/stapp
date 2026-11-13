// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, createPostRequest, parseResponse } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"
import { getRecargosMetodo } from "@/lib/recargos"
import { cargarConfigMoneda, resolverTipoCambio } from "@/lib/currency/tipo-cambio.server"
import { resolverConfigMoneda } from "@/lib/currency/config-moneda"

vi.mock("@/lib/recargos", async (orig) => {
  const actual = (await orig()) as any
  return { ...actual, getRecargosMetodo: vi.fn().mockResolvedValue({}) }
})
vi.mock("@/lib/audit", () => ({ createAuditLogger: () => ({ create: vi.fn() }) }))
vi.mock("@/lib/webhooks/dispatcher", () => ({ emitWebhookEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/currency/tipo-cambio.server", () => ({
  cargarConfigMoneda: vi.fn(),
  resolverTipoCambio: vi.fn(),
}))

import { POST } from "@/app/api/ventas/route"

const configUsd = {
  config: {
    ...resolverConfigMoneda({ multimoneda_habilitada: true, moneda_extranjera: "USD" } as any, "AR"),
    habilitada: true,
    redondeoConversion: 10,
  },
  fila: null,
}
const tcOk = { disponible: true, valor: 1200, fuente: "BLUE", moneda: "USD", en: "x", estado: "vivo" } as any

const itemUsd = { id: "u", nombre: "Pantalla", moneda: "USD", precio_venta: 10, precio_compra: 6.04 }
const itemLocal = { id: "l", nombre: "Cable", moneda: null, precio_venta: 500, precio_compra: 200 }

function wire(inventario: unknown[], ventas: unknown = { id: "v1", numero_venta: 1, total: 0 }) {
  const depositosChain: any = {}
  for (const m of ["select", "eq", "is"]) depositosChain[m] = vi.fn().mockReturnValue(depositosChain)
  depositosChain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
  mockSupabaseFrom({
    inventario: createChainMock(inventario),
    organizations: createChainMock({ iva_regimen: "EXENTO" }),
    sucursales: createChainMock({ id: "suc" }),
    depositos: depositosChain,
    ventas: createChainMock(ventas),
    clientes: createChainMock({ id: "c1" }),
  })
}

const linea = (o: Record<string, unknown>) => ({
  descripcion: "X",
  cantidad: 1,
  precioUnitario: 1,
  diasGarantia: 0,
  descuento: 0,
  tipoDescuento: "MONTO",
  porcentajeDescuento: 0,
  ...o,
})
const venta = (items: unknown[], extra: Record<string, unknown> = {}) => ({
  clienteNombre: "Juan",
  items,
  metodoPago: "EFECTIVO",
  ...extra,
})
const post = (b: unknown) => POST(createPostRequest(b, "http://localhost/api/ventas"))
const rpcParams = () => vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as any

beforeEach(() => {
  vi.clearAllMocks()
  mockAuthSuccess({ role: "ADMIN" })
  vi.mocked(cargarConfigMoneda).mockResolvedValue(configUsd as any)
  vi.mocked(resolverTipoCambio).mockResolvedValue(tcOk)
  vi.mocked(getRecargosMetodo).mockResolvedValue({} as any)
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
    data: { ventaId: "v1", numeroVenta: 1, garantias: [], items: ["i1"] },
    error: null,
  } as any)
})

describe("POST /api/ventas con líneas en divisa", () => {
  it("convierte con la cotización del servidor e ignora el precio local del cliente", async () => {
    wire([itemUsd])
    const res = await post(venta([linea({ inventarioId: "u", costo: 99 })], { tipoCambio: 1200 }))
    expect(res.status).toBe(201)
    const p = rpcParams()
    expect(p.p_total).toBe(12000)
    expect(p.p_items[0]).toMatchObject({
      precioUnitario: 12000,
      monedaOrigen: "USD",
      precioOrigen: 10,
      tipoCambio: 1200,
      tipoCambioFuente: "BLUE",
      costoUnitario: 7250,
    })
    expect(p.p_items[0]).not.toHaveProperty("costo")
  })

  it("usa el precioOrigen que editó el cajero", async () => {
    wire([itemUsd])
    await post(venta([linea({ inventarioId: "u", precioOrigen: 12 })], { tipoCambio: 1200 }))
    expect(rpcParams().p_items[0]).toMatchObject({ precioUnitario: 14400, precioOrigen: 12 })
  })

  it("recargo del método: conversión, luego recargo (y descuento por línea)", async () => {
    wire([itemUsd])
    vi.mocked(getRecargosMetodo).mockResolvedValue({ EFECTIVO: 10 } as any)
    await post(venta([linea({ inventarioId: "u" })], { tipoCambio: 1200 }))
    expect(rpcParams().p_items[0].precioUnitario).toBe(13200)
    expect(rpcParams().p_total).toBe(13200)

    vi.mocked(supabaseAdmin.rpc).mockClear()
    await post(
      venta([linea({ inventarioId: "u", tipoDescuento: "PORCENTAJE", porcentajeDescuento: 10 })], { tipoCambio: 1200 })
    )
    expect(rpcParams().p_total).toBe(11880)
  })

  it("cotización distinta: 409 COTIZACION_CAMBIO y sin RPC", async () => {
    wire([itemUsd])
    const { status, body } = await parseResponse(await post(venta([linea({ inventarioId: "u" })], { tipoCambio: 1100 })))
    expect(status).toBe(409)
    expect(body.code).toBe("COTIZACION_CAMBIO")
    expect(body.anterior).toBe(1100)
    expect(body.nueva.valor).toBe(1200)
    expect(body.error).toContain("La cotización cambió de")
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("sin tipoCambio en el body: 409 con anterior null", async () => {
    wire([itemUsd])
    const { status, body } = await parseResponse(await post(venta([linea({ inventarioId: "u" })])))
    expect(status).toBe(409)
    expect(body.code).toBe("COTIZACION_CAMBIO")
    expect(body.anterior).toBeNull()
    expect(body.error).toContain("La venta necesita la cotización vigente")
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("función apagada: 409 DIVISA_NO_DISPONIBLE", async () => {
    wire([itemUsd])
    vi.mocked(cargarConfigMoneda).mockResolvedValue({ config: { ...configUsd.config, habilitada: false }, fila: null } as any)
    const { status, body } = await parseResponse(await post(venta([linea({ inventarioId: "u" })], { tipoCambio: 1200 })))
    expect(status).toBe(409)
    expect(body.code).toBe("DIVISA_NO_DISPONIBLE")
    expect(body.motivo).toBe("DESHABILITADA")
    expect(body.error).toContain("Pantalla")
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("sin cotización: 409 DIVISA_NO_DISPONIBLE", async () => {
    wire([itemUsd])
    vi.mocked(resolverTipoCambio).mockResolvedValue({ disponible: false, motivo: "SIN_COTIZACION" } as any)
    const { status, body } = await parseResponse(await post(venta([linea({ inventarioId: "u" })], { tipoCambio: 1200 })))
    expect(status).toBe(409)
    expect(body.code).toBe("DIVISA_NO_DISPONIBLE")
    expect(body.motivo).toBe("SIN_COTIZACION")
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("reintento idempotente con otra cotización tras el alta: devuelve la venta original, sin 409 ni RPC", async () => {
    wire([itemUsd], { id: "v-orig", numero_venta: 7, total: "12000", subtotal: "12000", descuento: "0" })
    const { status, body } = await parseResponse(
      await post(venta([linea({ inventarioId: "u" })], { tipoCambio: 1100, idempotencyKey: "k-1" }))
    )
    expect(status).toBe(201)
    expect(body).toMatchObject({ id: "v-orig", numeroVenta: 7, total: 12000 })
    expect(body).toHaveProperty("organizationName")
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
    expect(resolverTipoCambio).not.toHaveBeenCalled()
  })

  it("clave de idempotencia sin venta previa: sigue con el control de cotización", async () => {
    wire([itemUsd], null)
    const { status, body } = await parseResponse(
      await post(venta([linea({ inventarioId: "u" })], { tipoCambio: 1100, idempotencyKey: "k-2" }))
    )
    expect(status).toBe(409)
    expect(body.code).toBe("COTIZACION_CAMBIO")
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("venta mixta: la línea local no recibe claves nuevas", async () => {
    wire([itemUsd, itemLocal])
    await post(venta([linea({ inventarioId: "u" }), linea({ inventarioId: "l", precioUnitario: 500 })], { tipoCambio: 1200 }))
    const p = rpcParams()
    expect(p.p_total).toBe(12500)
    expect(p.p_items[0].monedaOrigen).toBe("USD")
    for (const k of ["monedaOrigen", "precioOrigen", "tipoCambio", "tipoCambioFuente", "costoUnitario"]) {
      expect(p.p_items[1]).not.toHaveProperty(k)
    }
  })
})

describe("POST /api/ventas sin líneas en divisa", () => {
  it("solo locales: mismo total/items que antes y no resuelve cotización", async () => {
    wire([itemLocal])
    const res = await post(venta([linea({ inventarioId: "l", precioUnitario: 500, costo: 200 })]))
    expect(res.status).toBe(201)
    const p = rpcParams()
    expect(p.p_total).toBe(500)
    expect(p.p_subtotal).toBe(500)
    expect(p.p_items[0]).toEqual({
      inventarioId: "l",
      descripcion: "X",
      cantidad: 1,
      precioUnitario: 500,
      diasGarantia: 0,
      descuento: 0,
      tipoDescuento: "MONTO",
      porcentajeDescuento: 0,
      costo: 200,
    })
    expect(resolverTipoCambio).not.toHaveBeenCalled()
    expect(cargarConfigMoneda).not.toHaveBeenCalled()
  })

  it("ítem que no es de la org (no vuelve en la lectura): línea local con el precio del request", async () => {
    wire([])
    await post(venta([linea({ inventarioId: "ajeno", precioUnitario: 700 })]))
    expect(rpcParams().p_total).toBe(700)
    expect(rpcParams().p_items[0]).not.toHaveProperty("monedaOrigen")
  })

  it("columna moneda inexistente (42703): todo local", async () => {
    wire([])
    const depos = (supabaseAdmin.from as any)("depositos")
    mockSupabaseFrom({
      inventario: createChainMock(null, { code: "42703", message: "no column" }),
      organizations: createChainMock({ iva_regimen: "EXENTO" }),
      sucursales: createChainMock({ id: "suc" }),
      depositos: depos,
      ventas: createChainMock({ id: "v1", numero_venta: 1, total: 0 }),
      clientes: createChainMock({ id: "c1" }),
    })
    const res = await post(venta([linea({ inventarioId: "l", precioUnitario: 500 })]))
    expect(res.status).toBe(201)
    expect(rpcParams().p_total).toBe(500)
  })
})
