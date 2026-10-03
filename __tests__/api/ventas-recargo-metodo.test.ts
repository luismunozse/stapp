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
import { getRecargosMetodo } from "@/lib/recargos"

vi.mock("@/lib/recargos", async (orig) => {
  const actual = (await orig()) as any
  return {
    ...actual,
    getRecargosMetodo: vi.fn().mockResolvedValue({ CUENTA_CORRIENTE: 3 }),
  }
})
vi.mock("@/lib/audit", () => ({
  createAuditLogger: () => ({ create: vi.fn() }),
}))
vi.mock("@/lib/webhooks/dispatcher", () => ({
  emitWebhookEvent: vi.fn().mockResolvedValue(undefined),
}))

import { POST } from "@/app/api/ventas/route"

const precioBase = 1000
const factor = 1.03
const qty = 1

function buildTableMocks() {
  // sucursales: sucursalParaEscritura needs this
  const sucursalesChain = createChainMock({ id: "suc-principal" })

  // depositos: getDepositoDeSucursal needs this
  const depositosChain: any = {}
  for (const m of ["select", "eq", "is"])
    depositosChain[m] = vi.fn().mockReturnValue(depositosChain)
  depositosChain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })

  // ventas: post-RPC selects
  const ventasChain = createChainMock({ id: "v1", numero_venta: 1, total: 1030 })

  mockSupabaseFrom({
    // EXENTO → no IVA branch, no extra ventas.update() for IVA snapshot
    organizations: createChainMock({ iva_regimen: "EXENTO" }),
    sucursales: sucursalesChain,
    depositos: depositosChain,
    ventas: ventasChain,
    // el cliente de la venta es de la organización
    clientes: createChainMock({ id: "c1" }),
  })
}

describe("POST /api/ventas — Task 5: factor de recargo por método de pago", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })

    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { ventaId: "v1", numeroVenta: 1, garantias: [], items: ["i1"] },
      error: null,
    } as any)

    buildTableMocks()
  })

  it("aplica factor 1.03 al p_total y a p_items[0].precioUnitario cuando el pago principal es CUENTA_CORRIENTE", async () => {
    const body = {
      clienteId: "c1",
      clienteNombre: "Juan",
      items: [
        {
          inventarioId: "inv1",
          descripcion: "X",
          cantidad: qty,
          precioUnitario: precioBase,
          diasGarantia: 0,
          descuento: 0,
          tipoDescuento: "MONTO",
          porcentajeDescuento: 0,
        },
      ],
      descuento: 0,
      tipoDescuento: "MONTO",
      porcentajeDescuento: 0,
      metodoPago: "CUENTA_CORRIENTE",
      pagos: [{ metodo: "CUENTA_CORRIENTE", monto: precioBase * factor * qty }],
    }

    const res = await POST(
      createPostRequest(body, "http://localhost/api/ventas")
    )
    await parseResponse(res)

    const [, params] = vi.mocked(supabaseAdmin.rpc).mock.calls[0]
    const expected = Math.round((precioBase * factor + Number.EPSILON) * 100) / 100
    expect(params.p_total).toBeCloseTo(expected, 2)
    expect(params.p_items[0].precioUnitario).toBeCloseTo(expected, 2)
  })

  it("no aplica factor (1.0) cuando el método es EFECTIVO (sin recargo)", async () => {
    const body = {
      clienteId: "c1",
      clienteNombre: "Juan",
      items: [
        {
          inventarioId: "inv1",
          descripcion: "X",
          cantidad: qty,
          precioUnitario: precioBase,
          diasGarantia: 0,
          descuento: 0,
          tipoDescuento: "MONTO",
          porcentajeDescuento: 0,
        },
      ],
      descuento: 0,
      tipoDescuento: "MONTO",
      porcentajeDescuento: 0,
      metodoPago: "EFECTIVO",
      pagos: [{ metodo: "EFECTIVO", monto: precioBase }],
    }

    const res = await POST(
      createPostRequest(body, "http://localhost/api/ventas")
    )
    await parseResponse(res)

    const [, params] = vi.mocked(supabaseAdmin.rpc).mock.calls[0]
    expect(params.p_total).toBeCloseTo(precioBase, 2)
    expect(params.p_items[0].precioUnitario).toBeCloseTo(precioBase, 2)
  })

  it("C1 — rechaza con 400 venta no-parcial cuyo pagos[] suma menos que el total efectivo", async () => {
    // effective total = 1000 * 1.03 = 1030, but pagos only sends base price 1000
    const body = {
      clienteId: "c1",
      clienteNombre: "Juan",
      items: [
        {
          inventarioId: "inv1",
          descripcion: "X",
          cantidad: qty,
          precioUnitario: precioBase,
          diasGarantia: 0,
          descuento: 0,
          tipoDescuento: "MONTO",
          porcentajeDescuento: 0,
        },
      ],
      descuento: 0,
      tipoDescuento: "MONTO",
      porcentajeDescuento: 0,
      metodoPago: "CUENTA_CORRIENTE",
      // Deliberately underpaying: sending base 1000 instead of effective 1030
      pagos: [{ metodo: "CUENTA_CORRIENTE", monto: precioBase }],
    }

    const res = await POST(
      createPostRequest(body, "http://localhost/api/ventas")
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/no coincide/)
    // Must NOT call the RPC when payment is invalid
    expect(vi.mocked(supabaseAdmin.rpc)).not.toHaveBeenCalled()
  })
})

describe("POST /api/ventas — mismo total que el POS", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { ventaId: "v1", numeroVenta: 1, garantias: [], items: ["i1"] },
      error: null,
    } as any)
    buildTableMocks()
  })

  const item = (precioUnitario: number, extra: Record<string, unknown> = {}) => ({
    inventarioId: "inv1",
    descripcion: "X",
    cantidad: 1,
    precioUnitario,
    diasGarantia: 0,
    ...extra,
  })

  it("descuento en monto + tarjeta con recargo: acepta lo que cobró el POS ($9.900)", async () => {
    vi.mocked(getRecargosMetodo).mockResolvedValueOnce({ TARJETA_CREDITO: 10 })

    const res = await POST(
      createPostRequest(
        {
          clienteNombre: "CF",
          items: [item(10000, { tipoDescuento: "MONTO", descuento: 1000 })],
          metodoPago: "TARJETA_CREDITO",
          pagos: [{ metodo: "TARJETA_CREDITO", monto: 9900 }],
        },
        "http://localhost/api/ventas"
      )
    )
    const { status, body } = await parseResponse(res)

    expect(status, body?.error).toBe(201)
    const [, params] = vi.mocked(supabaseAdmin.rpc).mock.calls[0]
    expect(params.p_total).toBe(9900)
    expect(params.p_subtotal).toBe(11000)
    expect(params.p_descuento).toBe(1100)
    // La línea guardada suma lo mismo que la venta (precio y descuento con recargo)
    expect(params.p_items[0]).toMatchObject({ precioUnitario: 11000, descuento: 1100 })
  })

  it("dos pagos que suman el total al centavo no piden cliente (2,86 + 11,45 = 14,31)", async () => {
    // En binario 2.86 + 11.45 = 14.309999…: antes quedaba "saldo pendiente" y
    // la venta sin cliente se rechazaba.
    vi.mocked(getRecargosMetodo).mockResolvedValueOnce({})

    const res = await POST(
      createPostRequest(
        {
          clienteNombre: "CF",
          items: [item(14.31)],
          metodoPago: "TRANSFERENCIA",
          pagos: [
            { metodo: "TRANSFERENCIA", monto: 2.86 },
            { metodo: "EFECTIVO", monto: 11.45 },
          ],
        },
        "http://localhost/api/ventas"
      )
    )
    const { status, body } = await parseResponse(res)
    expect(status, body?.error).toBe(201)
  })

  it("un centavo de diferencia se ajusta: el SQL recibe pagos que suman exacto el total", async () => {
    vi.mocked(getRecargosMetodo).mockResolvedValueOnce({})

    const res = await POST(
      createPostRequest(
        {
          clienteNombre: "CF",
          items: [item(100)],
          metodoPago: "TRANSFERENCIA",
          pagos: [
            { metodo: "TRANSFERENCIA", monto: 59.99 },
            { metodo: "EFECTIVO", monto: 40 },
          ],
        },
        "http://localhost/api/ventas"
      )
    )
    const { status, body } = await parseResponse(res)
    expect(status, body?.error).toBe(201)

    const [, params] = vi.mocked(supabaseAdmin.rpc).mock.calls[0]
    expect(params.p_pagos.map((p: any) => p.monto)).toEqual([60, 40])
  })

  it("una venta fiada no se redondea como si fuera en efectivo", async () => {
    vi.mocked(getRecargosMetodo).mockResolvedValueOnce({})
    mockSupabaseFrom({
      organizations: createChainMock({ iva_regimen: "EXENTO", redondeo_efectivo: 50 }),
      sucursales: createChainMock({ id: "suc-principal" }),
      ventas: createChainMock({ id: "v1", numero_venta: 1, total: 121 }),
      clientes: createChainMock({ id: "c1" }),
    })

    const res = await POST(
      createPostRequest(
        {
          clienteId: "c1",
          clienteNombre: "Juan",
          items: [item(121)],
          metodoPago: "EFECTIVO",
          pagosParcial: true,
        },
        "http://localhost/api/ventas"
      )
    )
    const { status, body } = await parseResponse(res)
    expect(status, body?.error).toBe(201)

    const [, params] = vi.mocked(supabaseAdmin.rpc).mock.calls[0]
    expect(params.p_total).toBe(121)
    expect(params.p_pagos).toEqual([])
  })

  it("rechaza un cliente de otra organización", async () => {
    vi.mocked(getRecargosMetodo).mockResolvedValueOnce({})
    mockSupabaseFrom({
      organizations: createChainMock({ iva_regimen: "EXENTO" }),
      ventas: createChainMock({ id: "v1" }),
      clientes: createChainMock(null),
    })

    const res = await POST(
      createPostRequest(
        { clienteId: "c-ajeno", clienteNombre: "X", items: [item(100)], metodoPago: "EFECTIVO", pagosParcial: true },
        "http://localhost/api/ventas"
      )
    )
    const { status, body } = await parseResponse(res)
    expect(status).toBe(400)
    expect(body.error).toMatch(/Cliente no encontrado/)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("saldo a favor sin cliente: 400 sin llamar al RPC", async () => {
    vi.mocked(getRecargosMetodo).mockResolvedValueOnce({})
    const res = await POST(
      createPostRequest(
        { clienteNombre: "CF", items: [item(100)], metodoPago: "CUENTA_CORRIENTE", pagos: [{ metodo: "CUENTA_CORRIENTE", monto: 100 }] },
        "http://localhost/api/ventas"
      )
    )
    const { status, body } = await parseResponse(res)
    expect(status).toBe(400)
    expect(body.error).toMatch(/saldo a favor/)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("camino viejo con saldo a favor: lo manda como pago para que se descuente de la cuenta", async () => {
    vi.mocked(getRecargosMetodo).mockResolvedValueOnce({})
    const res = await POST(
      createPostRequest(
        { clienteId: "c1", clienteNombre: "Juan", items: [item(100)], metodoPago: "CUENTA_CORRIENTE" },
        "http://localhost/api/ventas"
      )
    )
    expect((await parseResponse(res)).status).toBe(201)
    const [, params] = vi.mocked(supabaseAdmin.rpc).mock.calls[0]
    expect(params.p_pagos).toEqual([{ metodo: "CUENTA_CORRIENTE", monto: 100 }])
  })

  it("un método de pago inexistente es 400 de validación", async () => {
    const res = await POST(
      createPostRequest(
        { clienteNombre: "CF", items: [item(100)], metodoPago: "EFECTIVO", pagos: [{ metodo: "BITCOIN", monto: 100 }] },
        "http://localhost/api/ventas"
      )
    )
    const { status, body } = await parseResponse(res)
    expect(status).toBe(400)
    expect(body.error).toMatch(/pagos\.0\.metodo/)
  })
})
