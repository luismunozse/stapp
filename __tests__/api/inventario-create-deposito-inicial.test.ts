import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/webhooks/dispatcher", () => ({
  emitWebhookEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/sucursal", () => ({
  sucursalParaLectura: vi.fn(),
}))

import { sucursalParaLectura } from "@/lib/sucursal"
import { POST } from "@/app/api/inventario/route"

const itemRow = {
  id: "inv-new",
  codigo: "C1",
  nombre: "Pantalla",
  descripcion: null,
  categoria: "Repuestos",
  tipo_dispositivo: "CELULAR",
  stock: 5,
  stock_reservado: 0,
  precio_compra: 300,
  precio_venta: 900,
  proveedor: null,
  proveedor_id: null,
  organization_id: "org-1",
}

const baseBody = {
  codigo: "C1",
  nombre: "Pantalla",
  categoria: "Repuestos",
  tipoDispositivo: "CELULAR",
  stock: 5,
  precioCompra: 300,
  precioVenta: 900,
}

function post(extra: Record<string, unknown> = {}) {
  return POST(createPostRequest({ ...baseBody, ...extra }, "http://localhost:3000/api/inventario"))
}

function setup(opts: {
  deposito?: { id: string } | null
  principal?: string | null
  detalle?: { data: any; error: any }
  stock?: number
}) {
  const depositos = createChainMock(opts.deposito ?? null)
  const inventario = createChainMock({ ...itemRow, stock: opts.stock ?? 5 })
  const detalle = createChainMock(
    opts.detalle?.data ?? [{ id: "det-1" }],
    opts.detalle?.error ?? null
  )
  mockSupabaseFrom({ depositos, inventario, inventario_depositos: detalle, audit_logs: createChainMock(null) })
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
    data: opts.principal === undefined ? "dep-principal" : opts.principal,
    error: null,
  } as any)
  return { depositos, inventario, detalle }
}

describe("POST /api/inventario — depósito del stock inicial", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.mocked(sucursalParaLectura).mockResolvedValue({ verTodas: true, sucursalId: null } as any)
  })

  it("usuario atado a una sucursal: el depósito se filtra por esa sucursal y uno ajeno da 400", async () => {
    vi.mocked(sucursalParaLectura).mockResolvedValue({ verTodas: false, sucursalId: "suc-1" } as any)
    const { depositos, inventario } = setup({ deposito: null })
    const res = await post({ depositoId: "dep-otra-sucursal" })
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toBe("El depósito elegido no es válido")
    expect(depositos.eq).toHaveBeenCalledWith("sucursal_id", "suc-1")
    expect(inventario.insert).not.toHaveBeenCalled()
  })

  it("usuario atado a una sucursal con depósito propio: 201", async () => {
    vi.mocked(sucursalParaLectura).mockResolvedValue({ verTodas: false, sucursalId: "suc-1" } as any)
    const { depositos } = setup({ deposito: { id: "dep-2" } })
    const res = await post({ depositoId: "dep-2" })

    expect((await parseResponse(res)).status).toBe(201)
    expect(depositos.eq).toHaveBeenCalledWith("sucursal_id", "suc-1")
    expect(sucursalParaLectura).toHaveBeenCalledWith({ role: "ADMIN", userSucursalId: null })
  })

  it("verTodas: no filtra por sucursal", async () => {
    const { depositos } = setup({ deposito: { id: "dep-2" } })
    await post({ depositoId: "dep-2" })

    expect(depositos.eq).not.toHaveBeenCalledWith("sucursal_id", expect.anything())
  })

  it("valida el depósito contra la org, no borrado y activo (antes de insertar)", async () => {
    const { depositos, inventario } = setup({ deposito: null })
    const res = await post({ depositoId: "dep-ajeno" })
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toBe("El depósito elegido no es válido")
    expect(depositos.eq).toHaveBeenCalledWith("id", "dep-ajeno")
    expect(depositos.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(depositos.eq).toHaveBeenCalledWith("activo", true)
    expect(depositos.is).toHaveBeenCalledWith("deleted_at", null)
    expect(inventario.insert).not.toHaveBeenCalled()
  })

  it("mueve la fila sembrada al depósito elegido cuando difiere del principal", async () => {
    const { detalle } = setup({ deposito: { id: "dep-2" } })
    const res = await post({ depositoId: "dep-2" })
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body.advertencia).toBeUndefined()
    expect(detalle.update).toHaveBeenCalledWith({ deposito_id: "dep-2" })
    expect(detalle.eq).toHaveBeenCalledWith("inventario_id", "inv-new")
    expect(detalle.eq).toHaveBeenCalledWith("deposito_id", "dep-principal")
    expect(detalle.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("no mueve nada si el elegido es el principal", async () => {
    const { detalle } = setup({ deposito: { id: "dep-principal" } })
    const res = await post({ depositoId: "dep-principal" })
    expect((await parseResponse(res)).status).toBe(201)
    expect(detalle.update).not.toHaveBeenCalled()
    expect(detalle.insert).not.toHaveBeenCalled()
  })

  it("no mueve nada si el stock es 0", async () => {
    const { detalle } = setup({ deposito: { id: "dep-2" }, stock: 0 })
    const res = await post({ depositoId: "dep-2", stock: 0 })
    expect((await parseResponse(res)).status).toBe(201)
    expect(detalle.update).not.toHaveBeenCalled()
    expect(detalle.insert).not.toHaveBeenCalled()
  })

  it("sin depositoId no consulta depósitos ni mueve nada", async () => {
    const { depositos, detalle } = setup({})
    const res = await post()
    expect((await parseResponse(res)).status).toBe(201)
    expect(depositos.select).not.toHaveBeenCalled()
    expect(detalle.update).not.toHaveBeenCalled()
  })

  it("si el trigger no sembró fila (sin principal), inserta el detalle en el elegido", async () => {
    const { detalle } = setup({ deposito: { id: "dep-2" }, principal: null })
    const res = await post({ depositoId: "dep-2" })
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body.advertencia).toBeUndefined()
    expect(detalle.update).not.toHaveBeenCalled()
    expect(detalle.insert).toHaveBeenCalledWith({
      inventario_id: "inv-new",
      deposito_id: "dep-2",
      stock: 5,
      stock_reservado: 0,
      organization_id: "org-1",
    })
  })

  it("si el principal existe pero no había fila sembrada, inserta en el elegido", async () => {
    const { detalle } = setup({ deposito: { id: "dep-2" }, detalle: { data: [], error: null } })
    const res = await post({ depositoId: "dep-2" })
    expect((await parseResponse(res)).status).toBe(201)
    expect(detalle.insert).toHaveBeenCalledWith(expect.objectContaining({ deposito_id: "dep-2", stock: 5 }))
  })

  it("si el movimiento falla responde 201 con advertencia (el item ya existe)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    setup({ deposito: { id: "dep-2" }, detalle: { data: null, error: { message: "boom" } } })
    const res = await post({ depositoId: "dep-2" })
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body.id).toBe("inv-new")
    expect(body.advertencia).toBe("El stock quedó en el depósito principal")
  })
})
