import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
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

// Desde la migracion 280, agregar/eliminar una linea de servicio corre atomicamente
// dentro de agregar_servicio_orden / eliminar_servicio_orden (SELECT ... FOR UPDATE
// + suma + sincronizacion de costo_final, todo en la misma transaccion de Postgres).
// La ruta ya no hace SELECT-then-decide-then-UPDATE en JS, asi que estos tests mockean
// supabaseAdmin.rpc en vez de supabaseAdmin.from("ordenes_servicio")/("servicios_orden").
// El lookup del catalogo (tipo: "catalogo") sigue fuera del RPC y sigue mockeando
// supabaseAdmin.from("servicios").
function mockRpc(data: any) {
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data, error: null } as any)
}

describe("POST /api/ordenes/[id]/servicios", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ organizationId: "org-1", role: "TECNICO" })
  })

  it("agrega una linea ad-hoc y autocompleta costo_final", async () => {
    mockRpc({
      success: true, id: "lin-1", servicio_id: null, nombre: "Instalacion de Windows",
      cantidad: 1, precio_unitario: 25000, costoFinalActualizado: true, sumaServicios: 25000,
    })

    const res = await POST(
      createPostRequest({ tipo: "manual", nombre: "Instalacion de Windows", cantidad: 1, precioUnitario: 25000 }),
      params("ord-1")
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body.costoFinalActualizado).toBe(true)
    expect(body.sumaServicios).toBe(25000)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "agregar_servicio_orden",
      expect.objectContaining({
        p_orden_id: "ord-1",
        p_organization_id: "org-1",
        p_servicio_id: null,
        p_nombre: "Instalacion de Windows",
        p_cantidad: 1,
        p_precio_unitario: 25000,
      })
    )
  })

  it("el servicio devuelto refleja la fila persistida por el RPC, no el precio enviado en el request", async () => {
    // El RPC devuelve precio_unitario tal como quedo en la columna DECIMAL(10,2)
    // (Postgres redondea al guardar), y la ruta debe construir la respuesta con
    // ESE valor, no con el que mando el cliente. Mockeamos un mismatch
    // deliberado (100.999 enviado vs. 101 persistido) para probarlo: si la ruta
    // volviera a construir el DTO con las variables locales del request (el bug
    // de Finding 3), este test fallaria con precioUnitario: 100.999.
    mockRpc({
      success: true, id: "lin-2", servicio_id: null, nombre: "Ajuste",
      cantidad: 1, precio_unitario: 101, costoFinalActualizado: true, sumaServicios: 101,
    })

    const res = await POST(
      createPostRequest({ tipo: "manual", nombre: "Ajuste", cantidad: 1, precioUnitario: 100.999 }),
      params("ord-1")
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body.servicio).toEqual({
      id: "lin-2", servicioId: null, nombre: "Ajuste", cantidad: 1, precioUnitario: 101,
    })
  })

  it("relaya costoFinalActualizado=false del RPC cuando la orden ya tiene cobros", async () => {
    // La regla real (bloquear cuando total_cobrado > 0) vive en la migracion
    // 280 (SQL) y no es alcanzable a traves de un supabaseAdmin.rpc mockeado.
    // Esta cubierta por PROBE 3 de supabase/migrations/verify/280_probes.sql.
    // Este test solo verifica que la ruta relaya fielmente el veredicto del RPC.
    mockRpc({
      success: true, id: "lin-1", servicio_id: null, nombre: "Extra",
      cantidad: 1, precio_unitario: 5000, costoFinalActualizado: false, sumaServicios: 15000,
    })

    const res = await POST(
      createPostRequest({ tipo: "manual", nombre: "Extra", cantidad: 1, precioUnitario: 5000 }),
      params("ord-1")
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body.costoFinalActualizado).toBe(false)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "agregar_servicio_orden",
      expect.objectContaining({ p_organization_id: "org-1" })
    )
  })

  it("devuelve 404 si la orden es de otra organizacion", async () => {
    mockRpc({ error: "Orden no encontrada" })

    const res = await POST(
      createPostRequest({ tipo: "manual", nombre: "X", cantidad: 1, precioUnitario: 1 }),
      params("ord-ajena")
    )
    const { status } = await parseResponse(res)

    expect(status).toBe(404)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "agregar_servicio_orden",
      expect.objectContaining({ p_orden_id: "ord-ajena", p_organization_id: "org-1" })
    )
  })

  it("rechaza cantidad cero", async () => {
    const res = await POST(
      createPostRequest({ tipo: "manual", nombre: "X", cantidad: 0, precioUnitario: 100 }),
      params("ord-1")
    )
    const { status } = await parseResponse(res)

    expect(status).toBe(400)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("tipo catalogo usa nombre y precio del catalogo como snapshot cuando no se envia precioUnitario", async () => {
    const servicioChain = createChainMock({
      id: "srv-9", nombre: "Cambio de pantalla", precio: 15000,
    })
    mockSupabaseFrom({ servicios: servicioChain })
    mockRpc({
      success: true, id: "lin-1", servicio_id: "srv-9", nombre: "Cambio de pantalla",
      cantidad: 1, precio_unitario: 15000, costoFinalActualizado: true, sumaServicios: 15000,
    })

    const res = await POST(
      createPostRequest({ tipo: "catalogo", servicioId: "srv-9", cantidad: 1 }),
      params("ord-1")
    )
    const { status } = await parseResponse(res)

    expect(status).toBe(201)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "agregar_servicio_orden",
      expect.objectContaining({ p_servicio_id: "srv-9", p_nombre: "Cambio de pantalla", p_precio_unitario: 15000 })
    )
    expect(servicioChain.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("tipo catalogo con precioUnitario explicito usa el valor enviado en vez del precio del catalogo", async () => {
    const servicioChain = createChainMock({
      id: "srv-9", nombre: "Cambio de pantalla", precio: 15000,
    })
    mockSupabaseFrom({ servicios: servicioChain })
    mockRpc({
      success: true, id: "lin-1", servicio_id: "srv-9", nombre: "Cambio de pantalla",
      cantidad: 1, precio_unitario: 20000, costoFinalActualizado: true, sumaServicios: 20000,
    })

    const res = await POST(
      createPostRequest({ tipo: "catalogo", servicioId: "srv-9", cantidad: 1, precioUnitario: 20000 }),
      params("ord-1")
    )
    const { status } = await parseResponse(res)

    expect(status).toBe(201)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "agregar_servicio_orden",
      expect.objectContaining({ p_precio_unitario: 20000 })
    )
    expect(servicioChain.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("tipo catalogo con servicioId de otra organizacion devuelve 404", async () => {
    const servicioChain = createChainMock(null)
    mockSupabaseFrom({ servicios: servicioChain })

    const res = await POST(
      createPostRequest({ tipo: "catalogo", servicioId: "srv-ajeno", cantidad: 1 }),
      params("ord-1")
    )
    const { status } = await parseResponse(res)

    expect(status).toBe(404)
    expect(servicioChain.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })
})

describe("DELETE /api/ordenes/[id]/servicios", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ organizationId: "org-1", role: "TECNICO" })
  })

  it("elimina una linea y actualiza costo_final cuando la orden no tiene cobros", async () => {
    mockRpc({ success: true, costoFinalActualizado: true, sumaServicios: 25000 })

    const res = await DELETE(
      createDeleteRequest("http://localhost:3000/api/test?servicioOrdenId=lin-2"),
      params("ord-1")
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.costoFinalActualizado).toBe(true)
    expect(body.sumaServicios).toBe(25000)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "eliminar_servicio_orden",
      expect.objectContaining({ p_orden_id: "ord-1", p_organization_id: "org-1", p_servicio_orden_id: "lin-2" })
    )
  })

  it("relaya costoFinalActualizado=false del RPC cuando la orden ya tiene cobros", async () => {
    // Misma razon que la variante POST de este nombre: la regla real vive en
    // la migracion 280 (SQL, PROBE 3 de 280_probes.sql) y no es alcanzable a
    // traves de un mock de supabaseAdmin.rpc. Esto solo prueba el relay.
    mockRpc({ success: true, costoFinalActualizado: false, sumaServicios: 30000 })

    const res = await DELETE(
      createDeleteRequest("http://localhost:3000/api/test?servicioOrdenId=lin-2"),
      params("ord-1")
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.costoFinalActualizado).toBe(false)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "eliminar_servicio_orden",
      expect.objectContaining({ p_organization_id: "org-1" })
    )
  })

  it("relaya costoFinalActualizado=true y sumaServicios=0 del RPC al eliminar la ultima linea", async () => {
    // El NULL (no 0) que realmente queda en costo_final lo decide y persiste el
    // RPC (SQL); esta cubierto por PROBE 4 de supabase/migrations/verify/280_probes.sql,
    // que si puede leer el valor final de la columna. Este test solo prueba
    // que la ruta relaya el veredicto del RPC mockeado sin alterarlo.
    mockRpc({ success: true, costoFinalActualizado: true, sumaServicios: 0 })

    const res = await DELETE(
      createDeleteRequest("http://localhost:3000/api/test?servicioOrdenId=lin-1"),
      params("ord-1")
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.costoFinalActualizado).toBe(true)
    expect(body.sumaServicios).toBe(0)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "eliminar_servicio_orden",
      expect.objectContaining({ p_orden_id: "ord-1", p_organization_id: "org-1", p_servicio_orden_id: "lin-1" })
    )
  })

  it("relaya costoFinalActualizado=false del RPC cuando la orden esta en REPARADO", async () => {
    // El STATE GUARD que decide esto vive en la migracion 280 (SQL), no en la
    // ruta. Este test verifica que la ruta relaya fielmente lo que devuelve el
    // RPC; el comportamiento del guard en si esta cubierto por
    // supabase/migrations/verify/280_probes.sql (PROBE 5).
    mockRpc({ success: true, costoFinalActualizado: false, sumaServicios: 0 })

    const res = await DELETE(
      createDeleteRequest("http://localhost:3000/api/test?servicioOrdenId=lin-1"),
      params("ord-1")
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.costoFinalActualizado).toBe(false)
    expect(body.sumaServicios).toBe(0)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "eliminar_servicio_orden",
      expect.objectContaining({ p_organization_id: "org-1" })
    )
  })

  it("sin servicioOrdenId en el query devuelve 400", async () => {
    const res = await DELETE(createDeleteRequest(), params("ord-1"))
    const { status } = await parseResponse(res)

    expect(status).toBe(400)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("con servicioOrdenId que no pertenece a la orden devuelve 404", async () => {
    mockRpc({ error: "Servicio no encontrado en la orden" })

    const res = await DELETE(
      createDeleteRequest("http://localhost:3000/api/test?servicioOrdenId=lin-999"),
      params("ord-1")
    )
    const { status } = await parseResponse(res)

    expect(status).toBe(404)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "eliminar_servicio_orden",
      expect.objectContaining({ p_organization_id: "org-1", p_servicio_orden_id: "lin-999" })
    )
  })
})
