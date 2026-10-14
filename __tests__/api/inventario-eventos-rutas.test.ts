import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, createPostRequest, parseResponse } from "./helpers"

// Approval tests for the audit entries and webhooks of the single-item routes. They moved
// out of the routes into lib/inventario-eventos.ts (shared with the group save); these
// pin what each route still emits so that move changed nothing observable.

const { auditoria, createAuditLogger } = vi.hoisted(() => {
  const auditoria = { create: vi.fn(), update: vi.fn(), delete: vi.fn() }
  return { auditoria, createAuditLogger: vi.fn(() => auditoria) }
})

vi.mock("@/lib/audit", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/audit")>()),
  createAuditLogger,
}))
vi.mock("@/lib/webhooks/dispatcher", () => ({ emitWebhookEvent: vi.fn() }))
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }))

import { emitWebhookEvent } from "@/lib/webhooks/dispatcher"
import { POST } from "@/app/api/inventario/route"
import { PUT, DELETE } from "@/app/api/inventario/[id]/route"

const fila = (extra: Record<string, unknown> = {}) => ({
  id: "i1",
  organization_id: "org-1",
  codigo: "C1",
  nombre: "Pantalla",
  descripcion: null,
  categoria: "Repuestos",
  tipo_dispositivo: "CELULAR",
  stock: 0,
  stock_reservado: 0,
  precio_compra: 300,
  precio_venta: 900,
  proveedor: null,
  proveedor_id: "p1",
  stock_minimo: null,
  stock_maximo: null,
  punto_reorden: null,
  barcode: "7790001",
  ubicacion: null,
  deleted_at: null,
  ...extra,
})

const params = { params: Promise.resolve({ id: "i1" }) }
const putRequest = (body: unknown) =>
  new Request("http://localhost:3000/api/inventario/i1", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
const deleteRequest = (query = "") => new Request(`http://localhost:3000/api/inventario/i1${query}`, { method: "DELETE" })

/** The first call of supabaseAdmin.from gets `primera`, the second `segunda`. */
function dosLecturas(primera: unknown, segunda: unknown) {
  vi.mocked(supabaseAdmin.from)
    .mockImplementationOnce((() => createChainMock(primera)) as any)
    .mockImplementationOnce((() => createChainMock(segunda)) as any)
}

beforeEach(() => {
  vi.clearAllMocks()
  auditoria.create.mockResolvedValue(undefined)
  auditoria.update.mockResolvedValue(undefined)
  auditoria.delete.mockResolvedValue(undefined)
  vi.mocked(emitWebhookEvent).mockResolvedValue(undefined)
})

describe("POST /api/inventario emits the created events", () => {
  const cuerpo = {
    codigo: "C1", nombre: "Pantalla", categoria: "Repuestos", tipoDispositivo: "CELULAR", stock: 0,
    precioCompra: 300, precioVenta: 900,
  }

  it("writes the CREATE audit entry and the inventario.created webhook", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1", userId: "user-7" })
    mockSupabaseFrom({ inventario: createChainMock(fila()) })

    const { status } = await parseResponse(await POST(createPostRequest(cuerpo, "http://localhost:3000/api/inventario")))

    expect(status).toBe(201)
    expect(createAuditLogger).toHaveBeenCalledWith("org-1", "user-7", expect.any(Request))
    expect(auditoria.create).toHaveBeenCalledWith("inventario", "i1", {
      codigo: "C1", nombre: "Pantalla", categoria: "Repuestos", tipo_dispositivo: "CELULAR", stock: 0,
      precio_compra: 300, precio_venta: 900, proveedor_id: "p1", barcode: "7790001",
    })
    expect(emitWebhookEvent).toHaveBeenCalledTimes(1)
    expect(emitWebhookEvent).toHaveBeenCalledWith("org-1", "inventario.created", {
      id: "i1", codigo: "C1", nombre: "Pantalla", categoria: "Repuestos", tipoDispositivo: "CELULAR", stock: 0,
      precioVenta: 900, precioCompra: 300, proveedorId: "p1", barcode: "7790001",
    })
  })

  it("a failed insert emits nothing", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    mockSupabaseFrom({ inventario: createChainMock(null, { code: "XX000", message: "boom" }) })
    vi.spyOn(console, "error").mockImplementation(() => {})

    const { status } = await parseResponse(await POST(createPostRequest(cuerpo, "http://localhost:3000/api/inventario")))

    expect(status).toBe(500)
    expect(emitWebhookEvent).not.toHaveBeenCalled()
    expect(auditoria.create).not.toHaveBeenCalled()
  })
})

describe("PUT /api/inventario/[id] emits the updated events", () => {
  it("a price edit writes the UPDATE audit entry and the inventario.updated webhook with the diff", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1", userId: "user-7" })
    dosLecturas(fila(), fila({ precio_venta: 1200 }))

    const { status } = await parseResponse(await PUT(putRequest({ precioVenta: 1200 }), params))

    expect(status).toBe(200)
    expect(auditoria.update).toHaveBeenCalledTimes(1)
    const [entidad, id, antes, despues] = auditoria.update.mock.calls[0]
    expect([entidad, id, antes.precio_venta, despues.precio_venta, antes.codigo, despues.codigo]).toEqual(["inventario", "i1", 900, 1200, "C1", "C1"])
    expect(Object.keys(antes)).toHaveLength(14)
    expect(emitWebhookEvent).toHaveBeenCalledTimes(1)
    expect(emitWebhookEvent).toHaveBeenCalledWith("org-1", "inventario.updated", {
      id: "i1", codigo: "C1", nombre: "Pantalla", changes: { precio_venta: { before: 900, after: 1200 } },
    })
  })

  it("a save that changes no audited field emits nothing", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1", userId: "user-7" })
    dosLecturas(fila(), fila({ stock_reservado: 4, imagen_url: "x.jpg" }))

    const { status } = await parseResponse(await PUT(putRequest({ precioVenta: 900 }), params))

    expect(status).toBe(200)
    expect(auditoria.update).not.toHaveBeenCalled()
    expect(emitWebhookEvent).not.toHaveBeenCalled()
  })
})

describe("DELETE /api/inventario/[id]", () => {
  it("archiving writes the ARCHIVADO audit entry and the inventario.archived webhook", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1", userId: "user-7" })
    mockSupabaseFrom({ inventario: createChainMock(fila()) })

    const { status, body } = await parseResponse(await DELETE(deleteRequest("?archive=true"), params))

    expect(status).toBe(200)
    expect(body).toEqual({ success: true, archived: true })
    expect(auditoria.delete).toHaveBeenCalledTimes(1)
    expect(auditoria.delete.mock.calls[0].slice(0, 2)).toEqual(["inventario", "i1"])
    expect(auditoria.delete.mock.calls[0][2]).toMatchObject({ accion: "ARCHIVADO", codigo: "C1", nombre: "Pantalla", precio_venta: 900 })
    expect(emitWebhookEvent).toHaveBeenCalledTimes(1)
    expect(emitWebhookEvent).toHaveBeenCalledWith("org-1", "inventario.archived", {
      id: "i1", codigo: "C1", nombre: "Pantalla", archivedBy: "user-7",
    })
  })

  it("archiving an already archived item emits nothing", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    mockSupabaseFrom({ inventario: createChainMock(fila({ deleted_at: "2026-01-01T00:00:00Z" })) })

    const { body } = await parseResponse(await DELETE(deleteRequest("?archive=true"), params))

    expect(body).toEqual({ success: true, archived: true })
    expect(auditoria.delete).not.toHaveBeenCalled()
    expect(emitWebhookEvent).not.toHaveBeenCalled()
  })

  it("a hard delete keeps its own ELIMINADO audit entry and emits no webhook", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1", userId: "user-7" })
    mockSupabaseFrom({ inventario: createChainMock(fila(), null, 0) })

    const { status, body } = await parseResponse(await DELETE(deleteRequest(), params))

    expect(status).toBe(200)
    expect(body).toEqual({ success: true, archived: false })
    expect(auditoria.delete).toHaveBeenCalledTimes(1)
    expect(auditoria.delete.mock.calls[0][2]).toMatchObject({ accion: "ELIMINADO", codigo: "C1" })
    expect(emitWebhookEvent).not.toHaveBeenCalled()
  })
})
