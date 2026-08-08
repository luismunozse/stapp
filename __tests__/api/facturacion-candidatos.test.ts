/**
 * Tests: GET /api/facturacion/candidatos returns uninvoiced REPARADO/ENTREGADO
 * ordenes and uninvoiced COMPLETADA ventas, filtering out anything that
 * already has a factura.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, createGetRequest, parseResponse } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

import { GET as candidatosGet } from "@/app/api/facturacion/candidatos/route"

describe("GET /api/facturacion/candidatos", () => {
  beforeEach(() => vi.clearAllMocks())

  it("excludes ordenes and ventas that already have a factura", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ordenes_servicio") {
        return createChainMock([
          { id: "o1", numero_orden: 1, codigo_orden: "CEL001", dispositivo: "iPhone", clientes: { nombre: "Ana" }, facturas: [] },
          { id: "o2", numero_orden: 2, codigo_orden: "CEL002", dispositivo: "Samsung", clientes: { nombre: "Beto" }, facturas: [{ id: "f-existing" }] },
        ]) as any
      }
      if (table === "ventas") {
        return createChainMock([
          { id: "v1", numero_venta: 5, cliente_nombre: "Consumidor Final", total: 200, facturas: [] },
          { id: "v2", numero_venta: 6, cliente_nombre: "Carla", total: 300, facturas: [{ id: "f-existing-2" }] },
        ]) as any
      }
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    })

    const res = await candidatosGet(createGetRequest("http://localhost:3000/api/facturacion/candidatos"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.ordenes).toHaveLength(1)
    expect(body.ordenes[0].id).toBe("o1")
    expect(body.ventas).toHaveLength(1)
    expect(body.ventas[0].id).toBe("v1")
  })
})
