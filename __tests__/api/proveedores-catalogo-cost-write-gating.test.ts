import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  parseResponse,
} from "./helpers"

import { POST } from "@/app/api/proveedores/[id]/catalogo/route"
import { PUT } from "@/app/api/proveedores/[id]/catalogo/[itemId]/route"

/**
 * Reading precioReferencia is gated by hasInventarioAccess; writing it has to
 * be gated by the same rule.
 *
 * requireAdminOrVendedor() lets through a VENDEDOR whose org never opted into
 * `vendedores_administran_inventario`. That caller is refused the supplier
 * price on GET, so any precioReferencia in their payload cannot be a value
 * they were shown — it is either spoofed or the 0 of a form that never
 * received the real number. Applying it would let them overwrite a cost the
 * very same endpoint hides from them.
 *
 * Same shape as resolveCostoUnitario on the cotizaciones routes: the server
 * ignores a cost the caller is not allowed to see. On PUT the column is left
 * untouched (the stored value survives); on POST it lands null, because there
 * is no earlier value to preserve and the supplier's price cannot be honestly
 * invented from anywhere else.
 */

function itemCtx(id = "prov-1", itemId = "item-1") {
  return { params: Promise.resolve({ id, itemId }) }
}

function ctx(id = "prov-1") {
  return { params: Promise.resolve({ id }) }
}

function mockRole(role: string) {
  vi.mocked(auth).mockResolvedValue({
    user: { id: "u-1", organizationId: "org-1", role, email: "u@u.com" },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

const catalogoRow = {
  id: "item-1",
  proveedor_id: "prov-1",
  inventario_id: "inv-1",
  codigo_proveedor: "SKU-1",
  nombre: "Pantalla iPhone 12",
  descripcion: null,
  precio_referencia: 4500,
  moneda: "ARS",
  unidad: "unidad",
  notas: null,
  precio_actualizado_at: "2026-08-01T00:00:00.000Z",
  inventario: { id: "inv-1", codigo: "C1", nombre: "Pantalla iPhone 12" },
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
}

function wireSupabase(vendedoresHabilitados = false) {
  const captured: { update: any; insert: any } = { update: null, insert: null }

  const itemsChain: any = createChainMock(catalogoRow)
  itemsChain.update = vi.fn().mockImplementation((payload: any) => {
    captured.update = payload
    return itemsChain
  })
  itemsChain.insert = vi.fn().mockImplementation((payload: any) => {
    captured.insert = payload
    return itemsChain
  })

  mockSupabaseFrom({
    proveedor_catalogo_items: itemsChain,
    proveedores: createChainMock({ id: "prov-1" }),
    organizations: createChainMock({ vendedores_administran_inventario: vendedoresHabilitados }),
  })

  return captured
}

function putRequest(body: any) {
  return new Request("http://localhost:3000/api/test", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function postRequest(body: any) {
  return new Request("http://localhost:3000/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("PUT /api/proveedores/[id]/catalogo/[itemId] — reference price write gate", () => {
  beforeEach(() => vi.clearAllMocks())

  it("applies precioReferencia for ADMIN (no behavior change)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const captured = wireSupabase()

    const res = await PUT(putRequest({ precioReferencia: 999 }), itemCtx())
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(captured.update.precio_referencia).toBe(999)
  })

  it("applies precioReferencia for VENDEDOR when the org opted in", async () => {
    mockRole("VENDEDOR")
    const captured = wireSupabase(true)

    const res = await PUT(putRequest({ precioReferencia: 999 }), itemCtx())
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(captured.update.precio_referencia).toBe(999)
  })

  it("ignores a zeroed precioReferencia from a VENDEDOR without inventario access", async () => {
    mockRole("VENDEDOR")
    const captured = wireSupabase(false)

    const res = await PUT(
      putRequest({ nombre: "Pantalla iPhone 12 Pro", precioReferencia: 0 }),
      itemCtx()
    )
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    // The column is never written, so the stored cost survives untouched.
    expect(captured.update).not.toHaveProperty("precio_referencia")
    // The rest of the edit still goes through: only the cost is refused.
    expect(captured.update.nombre).toBe("Pantalla iPhone 12 Pro")
  })

  it("ignores an explicit null precioReferencia from a VENDEDOR without inventario access", async () => {
    mockRole("VENDEDOR")
    const captured = wireSupabase(false)

    const res = await PUT(putRequest({ precioReferencia: null }), itemCtx())
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(captured.update).not.toHaveProperty("precio_referencia")
  })
})

describe("POST /api/proveedores/[id]/catalogo — reference price write gate", () => {
  beforeEach(() => vi.clearAllMocks())

  it("stores precioReferencia for ADMIN (no behavior change)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const captured = wireSupabase()

    const res = await POST(postRequest({ nombre: "Pantalla", precioReferencia: 4500 }), ctx())
    const { status } = await parseResponse(res)

    expect(status).toBe(201)
    expect(captured.insert.precio_referencia).toBe(4500)
  })

  it("stores precioReferencia for VENDEDOR when the org opted in", async () => {
    mockRole("VENDEDOR")
    const captured = wireSupabase(true)

    const res = await POST(postRequest({ nombre: "Pantalla", precioReferencia: 4500 }), ctx())
    const { status } = await parseResponse(res)

    expect(status).toBe(201)
    expect(captured.insert.precio_referencia).toBe(4500)
  })

  it("drops precioReferencia sent by a VENDEDOR without inventario access", async () => {
    mockRole("VENDEDOR")
    const captured = wireSupabase(false)

    const res = await POST(postRequest({ nombre: "Pantalla", precioReferencia: 4500 }), ctx())
    const { status } = await parseResponse(res)

    expect(status).toBe(201)
    expect(captured.insert.precio_referencia).toBeNull()
    // The item is still created: only the cost is refused.
    expect(captured.insert.nombre).toBe("Pantalla")
  })
})
