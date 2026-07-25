import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"

import { POST, DELETE } from "@/app/api/ordenes/[id]/servicios/route"

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

function createDeleteRequest(url: string = "http://localhost:3000/api/test"): Request {
  return new Request(url, { method: "DELETE" })
}

describe("POST /api/ordenes/[id]/servicios", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ organizationId: "org-1", role: "TECNICO" })
  })

  it("agrega una linea ad-hoc y autocompleta costo_final", async () => {
    const ordenChain = createChainMock({
      id: "ord-1", costo_final: null, total_cobrado: 0, organization_id: "org-1",
    })
    const lineasChain = createChainMock([])
    const insertChain = createChainMock({
      id: "lin-1", servicio_id: null, nombre: "Instalacion de Windows",
      cantidad: 1, precio_unitario: 25000,
    })

    let llamadasAServiciosOrden = 0
    vi.mocked(
      (await import("@/lib/supabase")).supabaseAdmin.from
    ).mockImplementation((tabla: string) => {
      if (tabla === "ordenes_servicio") return ordenChain as any
      if (tabla === "servicios_orden") {
        llamadasAServiciosOrden += 1
        return (llamadasAServiciosOrden === 1 ? lineasChain : insertChain) as any
      }
      return createChainMock(null) as any
    })

    const res = await POST(
      createPostRequest({ tipo: "manual", nombre: "Instalacion de Windows", cantidad: 1, precioUnitario: 25000 }),
      params("ord-1")
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body.costoFinalActualizado).toBe(true)
    expect(body.sumaServicios).toBe(25000)
    expect(ordenChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ costo_final: 25000 })
    )
    expect(ordenChain.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("no toca costo_final si la orden ya tiene cobros", async () => {
    const ordenChain = createChainMock({
      id: "ord-1", costo_final: 20000, total_cobrado: 10000, organization_id: "org-1",
    })
    const lineasChain = createChainMock([])
    const insertChain = createChainMock({
      id: "lin-1", servicio_id: null, nombre: "Extra", cantidad: 1, precio_unitario: 5000,
    })

    let n = 0
    vi.mocked(
      (await import("@/lib/supabase")).supabaseAdmin.from
    ).mockImplementation((tabla: string) => {
      if (tabla === "ordenes_servicio") return ordenChain as any
      if (tabla === "servicios_orden") { n += 1; return (n === 1 ? lineasChain : insertChain) as any }
      return createChainMock(null) as any
    })

    const res = await POST(
      createPostRequest({ tipo: "manual", nombre: "Extra", cantidad: 1, precioUnitario: 5000 }),
      params("ord-1")
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body.costoFinalActualizado).toBe(false)
    expect(ordenChain.update).not.toHaveBeenCalled()
    expect(ordenChain.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("devuelve 404 si la orden es de otra organizacion", async () => {
    mockSupabaseFrom({
      ordenes_servicio: createChainMock(null, { message: "not found" }),
    })

    const res = await POST(
      createPostRequest({ tipo: "manual", nombre: "X", cantidad: 1, precioUnitario: 1 }),
      params("ord-ajena")
    )
    const { status } = await parseResponse(res)

    expect(status).toBe(404)
  })

  it("rechaza cantidad cero", async () => {
    mockSupabaseFrom({
      ordenes_servicio: createChainMock({
        id: "ord-1", costo_final: null, total_cobrado: 0, organization_id: "org-1",
      }),
    })

    const res = await POST(
      createPostRequest({ tipo: "manual", nombre: "X", cantidad: 0, precioUnitario: 100 }),
      params("ord-1")
    )
    const { status } = await parseResponse(res)

    expect(status).toBe(400)
  })

  it("tipo catalogo usa nombre y precio del catalogo como snapshot cuando no se envia precioUnitario", async () => {
    const ordenChain = createChainMock({
      id: "ord-1", costo_final: null, total_cobrado: 0, organization_id: "org-1",
    })
    const servicioChain = createChainMock({
      id: "srv-9", nombre: "Cambio de pantalla", precio: 15000,
    })
    const lineasChain = createChainMock([])
    const insertChain = createChainMock({
      id: "lin-1", servicio_id: "srv-9", nombre: "Cambio de pantalla",
      cantidad: 1, precio_unitario: 15000,
    })

    let llamadasAServiciosOrden = 0
    vi.mocked(
      (await import("@/lib/supabase")).supabaseAdmin.from
    ).mockImplementation((tabla: string) => {
      if (tabla === "ordenes_servicio") return ordenChain as any
      if (tabla === "servicios") return servicioChain as any
      if (tabla === "servicios_orden") {
        llamadasAServiciosOrden += 1
        return (llamadasAServiciosOrden === 1 ? lineasChain : insertChain) as any
      }
      return createChainMock(null) as any
    })

    const res = await POST(
      createPostRequest({ tipo: "catalogo", servicioId: "srv-9", cantidad: 1 }),
      params("ord-1")
    )
    const { status } = await parseResponse(res)

    expect(status).toBe(201)
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ servicio_id: "srv-9", nombre: "Cambio de pantalla", precio_unitario: 15000 })
    )
    expect(servicioChain.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("tipo catalogo con precioUnitario explicito usa el valor enviado en vez del precio del catalogo", async () => {
    const ordenChain = createChainMock({
      id: "ord-1", costo_final: null, total_cobrado: 0, organization_id: "org-1",
    })
    const servicioChain = createChainMock({
      id: "srv-9", nombre: "Cambio de pantalla", precio: 15000,
    })
    const lineasChain = createChainMock([])
    const insertChain = createChainMock({
      id: "lin-1", servicio_id: "srv-9", nombre: "Cambio de pantalla",
      cantidad: 1, precio_unitario: 20000,
    })

    let llamadasAServiciosOrden = 0
    vi.mocked(
      (await import("@/lib/supabase")).supabaseAdmin.from
    ).mockImplementation((tabla: string) => {
      if (tabla === "ordenes_servicio") return ordenChain as any
      if (tabla === "servicios") return servicioChain as any
      if (tabla === "servicios_orden") {
        llamadasAServiciosOrden += 1
        return (llamadasAServiciosOrden === 1 ? lineasChain : insertChain) as any
      }
      return createChainMock(null) as any
    })

    const res = await POST(
      createPostRequest({ tipo: "catalogo", servicioId: "srv-9", cantidad: 1, precioUnitario: 20000 }),
      params("ord-1")
    )
    const { status } = await parseResponse(res)

    expect(status).toBe(201)
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ precio_unitario: 20000 })
    )
  })

  it("tipo catalogo con servicioId de otra organizacion devuelve 404", async () => {
    const ordenChain = createChainMock({
      id: "ord-1", costo_final: null, total_cobrado: 0, organization_id: "org-1",
    })
    const servicioChain = createChainMock(null)

    vi.mocked(
      (await import("@/lib/supabase")).supabaseAdmin.from
    ).mockImplementation((tabla: string) => {
      if (tabla === "ordenes_servicio") return ordenChain as any
      if (tabla === "servicios") return servicioChain as any
      return createChainMock(null) as any
    })

    const res = await POST(
      createPostRequest({ tipo: "catalogo", servicioId: "srv-ajeno", cantidad: 1 }),
      params("ord-1")
    )
    const { status } = await parseResponse(res)

    expect(status).toBe(404)
  })
})

describe("DELETE /api/ordenes/[id]/servicios", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ organizationId: "org-1", role: "TECNICO" })
  })

  it("elimina una linea y actualiza costo_final cuando la orden no tiene cobros", async () => {
    const ordenChain = createChainMock({
      id: "ord-1", costo_final: 30000, total_cobrado: 0, organization_id: "org-1",
    })
    const lineasChain = createChainMock([
      { id: "lin-1", cantidad: 1, precio_unitario: 25000 },
      { id: "lin-2", cantidad: 1, precio_unitario: 5000 },
    ])
    const deleteChain = createChainMock(null)

    let llamadasAServiciosOrden = 0
    vi.mocked(
      (await import("@/lib/supabase")).supabaseAdmin.from
    ).mockImplementation((tabla: string) => {
      if (tabla === "ordenes_servicio") return ordenChain as any
      if (tabla === "servicios_orden") {
        llamadasAServiciosOrden += 1
        return (llamadasAServiciosOrden === 1 ? lineasChain : deleteChain) as any
      }
      return createChainMock(null) as any
    })

    const res = await DELETE(
      createDeleteRequest("http://localhost:3000/api/test?servicioOrdenId=lin-2"),
      params("ord-1")
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.costoFinalActualizado).toBe(true)
    expect(body.sumaServicios).toBe(25000)
    expect(ordenChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ costo_final: 25000 })
    )
    expect(ordenChain.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("no toca costo_final si la orden ya tiene cobros", async () => {
    const ordenChain = createChainMock({
      id: "ord-1", costo_final: 30000, total_cobrado: 10000, organization_id: "org-1",
    })
    const lineasChain = createChainMock([
      { id: "lin-1", cantidad: 1, precio_unitario: 25000 },
      { id: "lin-2", cantidad: 1, precio_unitario: 5000 },
    ])
    const deleteChain = createChainMock(null)

    let n = 0
    vi.mocked(
      (await import("@/lib/supabase")).supabaseAdmin.from
    ).mockImplementation((tabla: string) => {
      if (tabla === "ordenes_servicio") return ordenChain as any
      if (tabla === "servicios_orden") { n += 1; return (n === 1 ? lineasChain : deleteChain) as any }
      return createChainMock(null) as any
    })

    const res = await DELETE(
      createDeleteRequest("http://localhost:3000/api/test?servicioOrdenId=lin-2"),
      params("ord-1")
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.costoFinalActualizado).toBe(false)
    expect(ordenChain.update).not.toHaveBeenCalled()
  })

  it("al eliminar la ultima linea deja costo_final en null", async () => {
    const ordenChain = createChainMock({
      id: "ord-1", costo_final: 5000, total_cobrado: 0, organization_id: "org-1",
    })
    const lineasChain = createChainMock([
      { id: "lin-1", cantidad: 1, precio_unitario: 5000 },
    ])
    const deleteChain = createChainMock(null)

    let n = 0
    vi.mocked(
      (await import("@/lib/supabase")).supabaseAdmin.from
    ).mockImplementation((tabla: string) => {
      if (tabla === "ordenes_servicio") return ordenChain as any
      if (tabla === "servicios_orden") { n += 1; return (n === 1 ? lineasChain : deleteChain) as any }
      return createChainMock(null) as any
    })

    const res = await DELETE(
      createDeleteRequest("http://localhost:3000/api/test?servicioOrdenId=lin-1"),
      params("ord-1")
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.costoFinalActualizado).toBe(true)
    expect(body.sumaServicios).toBe(0)
    expect(ordenChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ costo_final: null })
    )
  })

  it("sin servicioOrdenId en el query devuelve 400", async () => {
    mockSupabaseFrom({
      ordenes_servicio: createChainMock({
        id: "ord-1", costo_final: null, total_cobrado: 0, organization_id: "org-1",
      }),
    })

    const res = await DELETE(createDeleteRequest(), params("ord-1"))
    const { status } = await parseResponse(res)

    expect(status).toBe(400)
  })

  it("con servicioOrdenId que no pertenece a la orden devuelve 404", async () => {
    const ordenChain = createChainMock({
      id: "ord-1", costo_final: null, total_cobrado: 0, organization_id: "org-1",
    })
    const lineasChain = createChainMock([
      { id: "lin-1", cantidad: 1, precio_unitario: 5000 },
    ])

    vi.mocked(
      (await import("@/lib/supabase")).supabaseAdmin.from
    ).mockImplementation((tabla: string) => {
      if (tabla === "ordenes_servicio") return ordenChain as any
      if (tabla === "servicios_orden") return lineasChain as any
      return createChainMock(null) as any
    })

    const res = await DELETE(
      createDeleteRequest("http://localhost:3000/api/test?servicioOrdenId=lin-999"),
      params("ord-1")
    )
    const { status } = await parseResponse(res)

    expect(status).toBe(404)
  })
})
