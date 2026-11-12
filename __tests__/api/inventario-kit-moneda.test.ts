import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { cargarConfigMoneda, resolverTipoCambio } from "@/lib/currency/tipo-cambio.server"
import { resolverConfigMoneda } from "@/lib/currency/config-moneda"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, createGetRequest, parseResponse } from "./helpers"

// Costo de kit con componentes en divisa: cotización una sola vez y solo si hace falta.

vi.mock("@/lib/currency/tipo-cambio.server", () => ({
  cargarConfigMoneda: vi.fn(),
  resolverTipoCambio: vi.fn(),
}))

import { GET as getKitsList } from "@/app/api/inventario/kits/route"
import { GET as getKitDetail } from "@/app/api/inventario/[id]/kit/route"

const configUsd = {
  config: { ...resolverConfigMoneda({ multimoneda_habilitada: true, moneda_extranjera: "USD" } as any, "AR"), habilitada: true },
  fila: null,
}
const tcOk = { disponible: true, valor: 1200, fuente: "MANUAL", estado: "manual" } as any
const tcNo = { disponible: false, motivo: "sin_cotizacion" } as any

const ctx = () => ({ params: Promise.resolve({ id: "kit-1" }) })

const kitRow = {
  id: "kit-1", codigo: "K1", nombre: "Kit", stock: 5, stock_reservado: 0, precio_compra: 0,
  precio_venta: 90000, es_kit: true, tipo_kit: "ENSAMBLADO", imagen_url: null,
  categoria: "Kits", tipo_dispositivo: "CELULAR",
}
const comp = (id: string, cantidad: number, precio: number, moneda: string | null) => ({
  id: `ki-${id}`, kit_id: "kit-1", componente_id: id, cantidad, es_obligatorio: true, notas: null, orden: 0,
  created_at: "x", updated_at: "x",
  componente: {
    id, codigo: id, nombre: id, stock: 1, stock_reservado: 0, precio_compra: precio,
    imagen_url: null, es_kit: false, tipo_kit: null, moneda,
  },
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(cargarConfigMoneda).mockResolvedValue(configUsd as any)
  vi.mocked(resolverTipoCambio).mockResolvedValue(tcOk)
})

describe("GET /api/inventario/kits con componentes en divisa", () => {
  const wire = (items: unknown[]) =>
    mockSupabaseFrom({
      inventario: createChainMock([kitRow], null, 1),
      inventario_kit_items: createChainMock(items),
    })

  it("suma el costo en local: 2 x USD 10 a 1200 + 1 x 500 local = 24500", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    wire([
      { kit_id: "kit-1", cantidad: 2, componente: { precio_compra: 10, moneda: "USD" } },
      { kit_id: "kit-1", cantidad: 1, componente: { precio_compra: 500, moneda: null } },
    ])
    const { body } = await parseResponse(await getKitsList(createGetRequest()))
    expect(body.data[0].costoCalculado).toBe(24500)
    expect(body.data[0].costoNoDisponible).toBe(false)
  })

  it("es null (no disponible) con un componente EUR en org USD", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    wire([{ kit_id: "kit-1", cantidad: 1, componente: { precio_compra: 10, moneda: "EUR" } }])
    const { body } = await parseResponse(await getKitsList(createGetRequest()))
    expect(body.data[0].costoCalculado).toBeNull()
    expect(body.data[0].costoNoDisponible).toBe(true)
    expect(body.monedaExtranjera).toBe("USD")
  })

  it("es null (no disponible) sin cotización", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(resolverTipoCambio).mockResolvedValue(tcNo)
    wire([{ kit_id: "kit-1", cantidad: 1, componente: { precio_compra: 10, moneda: "USD" } }])
    const { body } = await parseResponse(await getKitsList(createGetRequest()))
    expect(body.data[0].costoNoDisponible).toBe(true)
  })

  it("no resuelve la cotización si ningún componente está en divisa", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    wire([{ kit_id: "kit-1", cantidad: 2, componente: { precio_compra: 500, moneda: null } }])
    const { body } = await parseResponse(await getKitsList(createGetRequest()))
    expect(body.data[0].costoCalculado).toBe(1000)
    expect(resolverTipoCambio).not.toHaveBeenCalled()
    expect(cargarConfigMoneda).not.toHaveBeenCalled()
  })

  it("sin acceso a costos sigue oculto y no resuelve la cotización", async () => {
    mockAuthSuccess({ role: "TECNICO" })
    wire([{ kit_id: "kit-1", cantidad: 1, componente: { precio_compra: 10, moneda: "USD" } }])
    const { body } = await parseResponse(await getKitsList(createGetRequest()))
    expect(body.data[0].costoCalculado).toBeNull()
    expect(body.data[0].costoNoDisponible).toBe(false)
    expect(resolverTipoCambio).not.toHaveBeenCalled()
  })
})

describe("GET /api/inventario/[id]/kit con componentes en divisa", () => {
  function wire(items: unknown[], costo: number | null = 24500) {
    mockSupabaseFrom({
      inventario: createChainMock(kitRow),
      inventario_kit_items: createChainMock(items),
    })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: costo, error: null } as any)
  }

  it("llama calcular_costo_kit con moneda, cotización y unidad efectiva; componentes llevan moneda", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    wire([comp("a", 2, 10, "USD"), comp("b", 1, 500, null)])
    const { body } = await parseResponse(await getKitDetail(createGetRequest(), ctx()))
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("calcular_costo_kit", {
      p_kit_id: "kit-1",
      p_org_id: "org-1",
      p_moneda: "USD",
      p_tipo_cambio: 1200,
      p_unidad: configUsd.config.redondeoConversion,
    })
    expect(body.componentes[0].componente.moneda).toBe("USD")
    expect(body.componentes[1].componente.moneda).toBeNull()
    expect(body.costoCalculado).toBe(24500)
    expect(body.costoNoDisponible).toBe(false)
  })

  it("pasa p_tipo_cambio null sin cotización y devuelve costoNoDisponible", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(resolverTipoCambio).mockResolvedValue(tcNo)
    wire([comp("a", 1, 10, "USD")], null)
    const { body } = await parseResponse(await getKitDetail(createGetRequest(), ctx()))
    expect(vi.mocked(supabaseAdmin.rpc).mock.calls[0][1]).toMatchObject({ p_moneda: "USD", p_tipo_cambio: null })
    expect(body.costoCalculado).toBeNull()
    expect(body.costoNoDisponible).toBe(true)
    expect(body.monedaExtranjera).toBe("USD")
  })

  it("sin componentes en divisa no resuelve la cotización", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    wire([comp("a", 2, 500, null)], 1000)
    const { body } = await parseResponse(await getKitDetail(createGetRequest(), ctx()))
    expect(resolverTipoCambio).not.toHaveBeenCalled()
    expect(body.costoCalculado).toBe(1000)
  })

  it("sin acceso a costos: oculto (null) pero no marcado como no disponible", async () => {
    mockAuthSuccess({ role: "TECNICO" })
    wire([comp("a", 1, 10, "USD")])
    const { body } = await parseResponse(await getKitDetail(createGetRequest(), ctx()))
    expect(body.costoCalculado).toBeNull()
    expect(body.costoNoDisponible).toBe(false)
    expect(resolverTipoCambio).not.toHaveBeenCalled()
  })
})
