import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { createChainMock, mockSupabaseFrom } from "@/__tests__/api/helpers"
import {
  moverStockInicialADeposito,
  moverStockInicialLote,
  reapuntarMovimientoStockInicial,
} from "@/lib/depositos"

function setup(opts: {
  principal?: string | null
  detalle?: { data: any; error: any }
  movimientoError?: { message: string } | null
} = {}) {
  const detalle = createChainMock(opts.detalle?.data ?? [{ id: "det-1" }], opts.detalle?.error ?? null)
  const movimientos = createChainMock(null, opts.movimientoError ?? null)
  mockSupabaseFrom({ inventario_depositos: detalle, movimientos_inventario: movimientos })
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
    data: opts.principal === undefined ? "dep-principal" : opts.principal,
    error: null,
  } as any)
  return { detalle, movimientos }
}

describe("reapuntarMovimientoStockInicial", () => {
  beforeEach(() => vi.clearAllMocks())

  it("re-apunta los movimientos STOCK_INICIAL de los items al deposito y sella el usuario", async () => {
    const { movimientos } = setup()
    await reapuntarMovimientoStockInicial({
      inventarioIds: ["inv-1", "inv-2"],
      depositoId: "dep-2",
      organizationId: "org-1",
      userId: "user-1",
    })

    expect(supabaseAdmin.from).toHaveBeenCalledWith("movimientos_inventario")
    expect(movimientos.update).toHaveBeenCalledWith({ deposito_id: "dep-2", usuario_id: "user-1" })
    expect(movimientos.in).toHaveBeenCalledWith("inventario_id", ["inv-1", "inv-2"])
    expect(movimientos.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(movimientos.eq).toHaveBeenCalledWith("referencia_tipo", "STOCK_INICIAL")
  })

  it("sin usuario no toca usuario_id", async () => {
    const { movimientos } = setup()
    await reapuntarMovimientoStockInicial({
      inventarioIds: ["inv-1"],
      depositoId: "dep-2",
      organizationId: "org-1",
      userId: null,
    })
    expect(movimientos.update).toHaveBeenCalledWith({ deposito_id: "dep-2" })
  })

  it("es best-effort: si falla loguea y no lanza", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    setup({ movimientoError: { message: "boom" } })
    await expect(
      reapuntarMovimientoStockInicial({
        inventarioIds: ["inv-1"],
        depositoId: "dep-2",
        organizationId: "org-1",
        userId: null,
      })
    ).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalled()
  })

  it("lista vacia: no consulta nada", async () => {
    setup()
    await reapuntarMovimientoStockInicial({
      inventarioIds: [],
      depositoId: "dep-2",
      organizationId: "org-1",
      userId: null,
    })
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})

describe("moverStockInicialADeposito — kardex del alta", () => {
  beforeEach(() => vi.clearAllMocks())

  const params = { inventarioId: "inv-1", depositoId: "dep-2", stock: 5, organizationId: "org-1", userId: "user-1" }

  it("tras mover la fila sembrada re-apunta el movimiento STOCK_INICIAL", async () => {
    const { movimientos } = setup()
    await moverStockInicialADeposito(params)
    expect(movimientos.update).toHaveBeenCalledWith({ deposito_id: "dep-2", usuario_id: "user-1" })
    expect(movimientos.in).toHaveBeenCalledWith("inventario_id", ["inv-1"])
    expect(movimientos.eq).toHaveBeenCalledWith("referencia_tipo", "STOCK_INICIAL")
  })

  it("tras el insert de respaldo (sin fila sembrada) tambien re-apunta", async () => {
    const { movimientos } = setup({ detalle: { data: [], error: null } })
    await moverStockInicialADeposito(params)
    expect(movimientos.update).toHaveBeenCalledWith({ deposito_id: "dep-2", usuario_id: "user-1" })
  })

  it("si el elegido es el principal no toca el kardex", async () => {
    const { movimientos } = setup({ principal: "dep-2" })
    await moverStockInicialADeposito(params)
    expect(movimientos.update).not.toHaveBeenCalled()
  })

  it("si el re-apunte falla, no lanza (el stock ya quedo bien)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    setup({ movimientoError: { message: "boom" } })
    await expect(moverStockInicialADeposito(params)).resolves.toBeUndefined()
  })

  it("si mover el detalle falla, lanza y no toca el kardex", async () => {
    const { movimientos } = setup({ detalle: { data: null, error: { message: "boom" } } })
    await expect(moverStockInicialADeposito(params)).rejects.toBeTruthy()
    expect(movimientos.update).not.toHaveBeenCalled()
  })
})

describe("moverStockInicialLote — kardex del alta", () => {
  beforeEach(() => vi.clearAllMocks())

  it("re-apunta los movimientos de todos los items movidos", async () => {
    const { movimientos } = setup()
    await moverStockInicialLote({
      inventarioIds: ["inv-1", "inv-2"],
      depositoId: "dep-2",
      organizationId: "org-1",
      userId: "user-1",
    })
    expect(movimientos.update).toHaveBeenCalledWith({ deposito_id: "dep-2", usuario_id: "user-1" })
    expect(movimientos.in).toHaveBeenCalledWith("inventario_id", ["inv-1", "inv-2"])
  })

  it("si el elegido es el principal no toca el kardex", async () => {
    const { movimientos } = setup({ principal: "dep-2" })
    await moverStockInicialLote({ inventarioIds: ["inv-1"], depositoId: "dep-2", organizationId: "org-1" })
    expect(movimientos.update).not.toHaveBeenCalled()
  })

  it("org sin principal: no mueve ni toca el kardex", async () => {
    const { movimientos } = setup({ principal: null })
    await moverStockInicialLote({ inventarioIds: ["inv-1"], depositoId: "dep-2", organizationId: "org-1" })
    expect(movimientos.update).not.toHaveBeenCalled()
  })

  it("parte en tramos de 200 ids", async () => {
    const { movimientos } = setup()
    const ids = Array.from({ length: 450 }, (_, i) => `inv-${i}`)
    await moverStockInicialLote({ inventarioIds: ids, depositoId: "dep-2", organizationId: "org-1" })
    expect(movimientos.update).toHaveBeenCalledTimes(3)
  })
})
