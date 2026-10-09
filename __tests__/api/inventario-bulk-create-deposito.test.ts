import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/sucursal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sucursal")>()),
  sucursalParaLectura: vi.fn().mockResolvedValue({ verTodas: true, sucursalId: null }),
}))

import { sucursalParaLectura } from "@/lib/sucursal"
import { POST } from "@/app/api/inventario/bulk-create/route"

const item = (nombre: string, stock: number) => ({
  nombre,
  categoria: "Repuestos",
  tipoDispositivo: "CELULAR",
  stock,
  precioCompra: 10,
  precioVenta: 20,
})

function post(items: unknown[]) {
  return POST(createPostRequest({ items }, "http://localhost:3000/api/inventario/bulk-create"))
}

function setup(opts: { detalleError?: { message: string } | null } = {}) {
  let n = 0
  const inventario = createChainMock(null)
  // Cada insert devuelve un item distinto (id incremental).
  inventario.single.mockImplementation(async () => {
    n++
    return { data: { id: `inv-${n}`, codigo: `C${n}`, nombre: `Item ${n}`, stock: 3 }, error: null }
  })
  const depositos = createChainMock({ id: "dep-b" })
  const detalle = createChainMock([{ id: "det" }], opts.detalleError ?? null)
  mockSupabaseFrom({
    organizations: createChainMock({ vendedores_administran_inventario: true }),
    inventario,
    depositos,
    inventario_depositos: detalle,
    audit_logs: createChainMock(null),
  })
  vi.mocked(supabaseAdmin.rpc).mockImplementation((async (fn: string) => {
    if (fn === "get_deposito_principal") return { data: "dep-principal", error: null }
    return { data: "COD-1", error: null }
  }) as any)
  return { depositos, detalle }
}

describe("POST /api/inventario/bulk-create — depósito por defecto", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sucursalParaLectura).mockResolvedValue({ verTodas: true, sucursalId: null })
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
  })

  it("VENDEDOR de la sucursal B: mueve la fila sembrada de cada item con stock al depósito de B", async () => {
    mockAuthSuccess({ role: "VENDEDOR", organizationId: "org-1", sucursalId: "suc-b" })
    vi.mocked(sucursalParaLectura).mockResolvedValue({ verTodas: false, sucursalId: "suc-b" })
    const { detalle, depositos } = setup()
    const res = await post([item("A", 3), item("B", 0), item("C", 2)])
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body.advertencias).toBeUndefined()
    // El depósito se resuelve una sola vez para todo el lote.
    expect(depositos.select).toHaveBeenCalledTimes(1)
    // Solo los items con stock > 0 se mueven.
    expect(detalle.update).toHaveBeenCalledTimes(2)
    expect(detalle.update).toHaveBeenCalledWith({ deposito_id: "dep-b" })
    expect(detalle.eq).toHaveBeenCalledWith("inventario_id", "inv-1")
    expect(detalle.eq).toHaveBeenCalledWith("inventario_id", "inv-3")
    expect(detalle.eq).not.toHaveBeenCalledWith("inventario_id", "inv-2")
  })

  it("ADMIN viendo todas: no resuelve depósito ni mueve nada", async () => {
    const { detalle, depositos } = setup()
    const res = await post([item("A", 3)])

    expect((await parseResponse(res)).status).toBe(201)
    expect(depositos.select).not.toHaveBeenCalled()
    expect(detalle.update).not.toHaveBeenCalled()
  })

  it("si el movimiento falla, el item queda creado y se informa una advertencia", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    mockAuthSuccess({ role: "VENDEDOR", organizationId: "org-1", sucursalId: "suc-b" })
    vi.mocked(sucursalParaLectura).mockResolvedValue({ verTodas: false, sucursalId: "suc-b" })
    setup({ detalleError: { message: "boom" } })
    const res = await post([item("A", 3)])
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body.createdCount).toBe(1)
    expect(body.errorCount).toBe(0)
    expect(body.advertencias).toEqual([
      { index: 0, nombre: "A", advertencia: "El stock quedó en el depósito principal" },
    ])
  })
})
