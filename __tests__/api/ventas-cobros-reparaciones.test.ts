/**
 * GET /api/ventas/cobros-reparaciones — los cobros de órdenes de reparación,
 * que viven en `cobros_orden` y por eso nunca aparecían en la pantalla Ventas.
 *
 * Alcance: el mismo que el listado de ventas. Entra quien tiene acceso al POS;
 * solo el ADMIN ve los cobros del resto, los demás ven los que registraron.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/sucursal", () => ({
  sucursalParaLectura: vi.fn().mockResolvedValue({ verTodas: true, sucursalId: null }),
}))

import { GET } from "@/app/api/ventas/cobros-reparaciones/route"
import { sucursalParaLectura } from "@/lib/sucursal"

const URL_BASE = "http://localhost:3000/api/ventas/cobros-reparaciones"

function cobroRow(over: Partial<any> = {}) {
  return {
    id: "cob-1",
    monto: "1500.50",
    metodo_pago: "EFECTIVO",
    numero_referencia: null,
    cuotas: null,
    created_at: "2026-11-19T15:00:00.000Z",
    anulado: false,
    orden_id: "o1",
    users: { id: "u1", nombre: "Ana" },
    ordenes_servicio: {
      id: "o1",
      numero_orden: 12,
      codigo_orden: "ORD-0012",
      dispositivo: "iPhone 13",
      marca: "Apple",
      sucursal_id: "suc-A",
      clientes: { nombre: "Juan Pérez" },
    },
    ...over,
  }
}

describe("GET /api/ventas/cobros-reparaciones", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sucursalParaLectura).mockResolvedValue({ verTodas: true, sucursalId: null } as any)
  })

  it("rechaza sin sesión", async () => {
    mockAuthError()
    const res = await GET(createGetRequest(URL_BASE))
    expect(res.status).toBe(401)
  })

  it("devuelve los cobros con su orden, cliente y quién cobró", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const cobros = createChainMock([cobroRow()], null, 1)
    mockSupabaseFrom({ cobros_orden: cobros })

    const res = await GET(createGetRequest(URL_BASE))
    const { status, body: data } = await parseResponse(res)

    expect(status).toBe(200)
    expect(data.total).toBe(1)
    expect(data.data[0]).toEqual({
      id: "cob-1",
      monto: 1500.5,
      metodoPago: "EFECTIVO",
      referencia: null,
      cuotas: null,
      fecha: "2026-11-19T15:00:00.000Z",
      anulado: false,
      cobradoPor: "Ana",
      orden: {
        id: "o1",
        codigo: "ORD-0012",
        numeroOrden: 12,
        equipo: "Apple iPhone 13",
        clienteNombre: "Juan Pérez",
      },
    })
    expect(cobros.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("el ADMIN ve los cobros de todos", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const cobros = createChainMock([], null, 0)
    mockSupabaseFrom({ cobros_orden: cobros })

    await GET(createGetRequest(URL_BASE))

    expect(cobros.eq).not.toHaveBeenCalledWith("usuario_id", expect.anything())
  })

  it("quien no es ADMIN solo ve los cobros que registró", async () => {
    mockAuthSuccess({ role: "VENDEDOR", userId: "vend-9" })
    const cobros = createChainMock([], null, 0)
    mockSupabaseFrom({ cobros_orden: cobros })

    await GET(createGetRequest(URL_BASE))

    expect(cobros.eq).toHaveBeenCalledWith("usuario_id", "vend-9")
  })

  it("filtra por la sucursal activa", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(sucursalParaLectura).mockResolvedValue({ verTodas: false, sucursalId: "suc-B" } as any)
    const cobros = createChainMock([], null, 0)
    mockSupabaseFrom({ cobros_orden: cobros })

    await GET(createGetRequest(URL_BASE))

    expect(cobros.eq).toHaveBeenCalledWith("ordenes_servicio.sucursal_id", "suc-B")
  })

  it("filtra por método de pago y descarta un método inventado", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const cobros = createChainMock([], null, 0)
    mockSupabaseFrom({ cobros_orden: cobros })

    await GET(createGetRequest(`${URL_BASE}?metodo=TRANSFERENCIA`))
    expect(cobros.eq).toHaveBeenCalledWith("metodo_pago", "TRANSFERENCIA")

    cobros.eq.mockClear()
    await GET(createGetRequest(`${URL_BASE}?metodo=CUALQUIERA`))
    expect(cobros.eq).not.toHaveBeenCalledWith("metodo_pago", expect.anything())
  })

  it("la búsqueda resuelve las órdenes que coinciden y filtra por ellas", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const clientes = createChainMock([{ id: "c7" }])
    const ordenes = createChainMock([{ id: "o1" }, { id: "o2" }])
    const cobros = createChainMock([cobroRow()], null, 1)
    mockSupabaseFrom({ clientes, ordenes_servicio: ordenes, cobros_orden: cobros })

    const res = await GET(createGetRequest(`${URL_BASE}?search=perez`))

    expect(res.status).toBe(200)
    expect(ordenes.or).toHaveBeenCalledWith(expect.stringContaining("cliente_id.in.(c7)"))
    expect(cobros.in).toHaveBeenCalledWith("orden_id", ["o1", "o2"])
  })

  it("una búsqueda sin órdenes que coincidan responde vacío sin consultar cobros", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const clientes = createChainMock([])
    const ordenes = createChainMock([])
    const cobros = createChainMock([cobroRow()], null, 1)
    mockSupabaseFrom({ clientes, ordenes_servicio: ordenes, cobros_orden: cobros })

    const res = await GET(createGetRequest(`${URL_BASE}?search=nadie`))
    const { body: data } = await parseResponse(res)

    expect(data).toEqual({ data: [], total: 0, page: 1, limit: 20 })
    expect(cobros.select).not.toHaveBeenCalled()
  })
})
