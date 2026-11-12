/**
 * GET /api/ordenes devuelve el estado de cobro y el saldo de cada fila,
 * calculados con la misma query de la lista (embed de NC, sin un SELECT por
 * orden) y siempre dentro de la organización del usuario.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/sucursal", () => ({
  sucursalParaLectura: vi.fn().mockResolvedValue({ verTodas: true, sucursalId: null }),
}))

import { GET } from "@/app/api/ordenes/route"

const fila = (over: Record<string, unknown>) => ({
  numero_orden: 1,
  organization_id: "org-2",
  tecnico_id: null,
  clientes: null,
  users: null,
  descuento_cobro: "0",
  total_cobrado: "0",
  notas_credito: [],
  ...over,
})

describe("GET /api/ordenes — estado de cobro y saldo por fila", () => {
  beforeEach(() => vi.clearAllMocks())

  it("calcula saldo y estado con cobros, descuento y NC activas", async () => {
    mockAuthSuccess({ organizationId: "org-2", role: "ADMIN" })
    const chain = createChainMock(
      [
        fila({
          id: "o1",
          estado: "ENTREGADO",
          costo_final: "1500.00",
          descuento_cobro: "100",
          total_cobrado: "400",
          notas_credito: [
            { monto_aplicado_deuda: "200", anulada: false },
            { monto_aplicado_deuda: "500", anulada: true },
          ],
        }),
        fila({ id: "o2", estado: "REPARADO", costo_final: "800", total_cobrado: "800" }),
        fila({ id: "o3", estado: "REPARADO", costo_final: "800" }),
        fila({ id: "o4", estado: "EN_DIAGNOSTICO", costo_final: null, total_cobrado: "300" }),
        fila({ id: "o5", estado: "ENTREGADO_SIN_COBRO", costo_final: "900" }),
      ],
      null,
      5
    )
    mockSupabaseFrom({ ordenes_servicio: chain, cuenta_corriente: createChainMock([]) })

    const { status, body } = await parseResponse(await GET(createGetRequest("http://localhost:3000/api/ordenes")))

    expect(status).toBe(200)
    const porId = Object.fromEntries(body.data.map((o: any) => [o.id, o]))
    expect(porId.o1).toMatchObject({ estadoPago: "PARCIAL", saldoPendiente: 800 })
    expect(porId.o2).toMatchObject({ estadoPago: "PAGADO", saldoPendiente: 0 })
    expect(porId.o3).toMatchObject({ estadoPago: "SIN_COBRAR", saldoPendiente: 800 })
    expect(porId.o4).toMatchObject({ estadoPago: "SENA", saldoPendiente: 0 })
    expect(porId.o5).toMatchObject({ estadoPago: "SIN_CARGO", saldoPendiente: 0 })
  })

  it("trae las NC en la misma query (sin N+1) y la acota a la organización", async () => {
    mockAuthSuccess({ organizationId: "org-2", role: "ADMIN" })
    const chain = createChainMock([fila({ id: "o1", estado: "REPARADO", costo_final: "100" })], null, 1)
    mockSupabaseFrom({ ordenes_servicio: chain, cuenta_corriente: createChainMock([]) })

    await GET(createGetRequest("http://localhost:3000/api/ordenes"))

    expect(chain.select).toHaveBeenCalledWith(
      expect.stringContaining("notas_credito (monto_aplicado_deuda, anulada)"),
      { count: "exact" }
    )
    expect(chain.eq).toHaveBeenCalledWith("organization_id", "org-2")
    // Una sola lectura de órdenes: nada de un SELECT por fila para el saldo.
    const tablas = vi.mocked(supabaseAdmin.from).mock.calls.map((c) => c[0])
    expect(tablas.filter((t) => t === "ordenes_servicio")).toHaveLength(1)
    expect(tablas).not.toContain("notas_credito")
    expect(tablas).not.toContain("cobros_orden")
  })

  it("una orden con el saldo en cuenta corriente no muestra 'Debe': una sola lectura de CARGOs por página, acotada a la org", async () => {
    mockAuthSuccess({ organizationId: "org-2", role: "ADMIN" })
    const ordenesChain = createChainMock(
      [
        fila({ id: "o1", estado: "ENTREGADO", costo_final: "1000", total_cobrado: "200" }),
        fila({ id: "o2", estado: "ENTREGADO", costo_final: "500" }),
        fila({ id: "o3", estado: "ENTREGADO", costo_final: "300" }),
        fila({ id: "o4", estado: "REPARADO", costo_final: "700", total_cobrado: "700" }),
      ],
      null,
      4
    )
    const ccChain = createChainMock([
      { referencia_id: "o1", monto: "800.00", revertido_at: null },
      { referencia_id: "o3", monto: "300.00", revertido_at: "2026-11-01T00:00:00Z" },
    ])
    mockSupabaseFrom({ ordenes_servicio: ordenesChain, cuenta_corriente: ccChain })

    const { body } = await parseResponse(await GET(createGetRequest("http://localhost:3000/api/ordenes")))

    const porId = Object.fromEntries(body.data.map((o: any) => [o.id, o]))
    expect(porId.o1).toMatchObject({ estadoPago: "CUENTA_CORRIENTE", saldoPendiente: 0, montoCuentaCorriente: 800 })
    expect(porId.o2).toMatchObject({ estadoPago: "SIN_COBRAR", saldoPendiente: 500 })
    expect(porId.o3).toMatchObject({ estadoPago: "SIN_CARGO", saldoPendiente: 0 })
    expect(porId.o4).toMatchObject({ estadoPago: "PAGADO", saldoPendiente: 0 })

    const tablas = vi.mocked(supabaseAdmin.from).mock.calls.map((c) => c[0])
    expect(tablas.filter((t) => t === "cuenta_corriente")).toHaveLength(1)
    expect(ccChain.eq).toHaveBeenCalledWith("organization_id", "org-2")
    expect(ccChain.eq).toHaveBeenCalledWith("tipo", "CARGO")
    expect(ccChain.eq).toHaveBeenCalledWith("referencia_tipo", "ORDEN")
    // Solo se consultan las órdenes que tienen saldo (la pagada no).
    expect(ccChain.in).toHaveBeenCalledWith("referencia_id", ["o1", "o2", "o3"])
  })

  it("sin órdenes con saldo no lee cuenta_corriente", async () => {
    mockAuthSuccess({ organizationId: "org-2", role: "ADMIN" })
    mockSupabaseFrom({
      ordenes_servicio: createChainMock([fila({ id: "o1", estado: "REPARADO", costo_final: "100", total_cobrado: "100" })], null, 1),
    })

    await GET(createGetRequest("http://localhost:3000/api/ordenes"))

    expect(vi.mocked(supabaseAdmin.from).mock.calls.map((c) => c[0])).not.toContain("cuenta_corriente")
  })

  it("cobroPendiente=true sigue aplicando sus filtros", async () => {
    mockAuthSuccess({ organizationId: "org-2", role: "ADMIN" })
    const chain = createChainMock([], null, 0)
    mockSupabaseFrom({ ordenes_servicio: chain })

    await GET(createGetRequest("http://localhost:3000/api/ordenes?cobroPendiente=true"))

    expect(chain.in).toHaveBeenCalledWith("estado_cobro", ["PENDIENTE", "PARCIAL"])
    expect(chain.eq).toHaveBeenCalledWith("organization_id", "org-2")
  })
})
