// __tests__/components/recepcion-detail.test.tsx
//
// RecepcionDetail — vista de detalle de un lote de recepcion multiple.
// Mockea fetch (GET/PATCH /api/recepciones/[id]) y useSession (ADMIN), igual
// que entrega-dialog-total.test.tsx hace para componentes que dependen de
// next-auth sin montar el SessionProvider real.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { RecepcionDetail } from "@/components/ordenes/recepcion-detail"

// Rol mutable: la entrega de lote y el editor de descuento son solo para
// ADMIN, asi que hace falta poder renderizar el mismo componente como VENDEDOR.
const sessionMock = vi.hoisted(() => ({ role: "ADMIN" }))
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { role: sessionMock.role } } }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function orden(overrides: Record<string, any> = {}) {
  return {
    id: "o1",
    numeroOrden: 1,
    codigoOrden: "CEL-001",
    dispositivo: "iPhone 13",
    marca: "Apple",
    estado: "REPARADO",
    presupuesto: null,
    costoFinal: 200,
    ...overrides,
  }
}

function buildResponse(overrides: Record<string, any> = {}) {
  return {
    recepcion: {
      id: "rec-1",
      numero: 42,
      codigo: "REC-042",
      clienteId: "cli-1",
      clienteNombre: "Juan Perez",
      descuentoTipo: "porcentaje",
      descuentoValor: 10,
      observaciones: null,
      createdAt: "2026-08-01T00:00:00.000Z",
    },
    ordenes: [
      {
        id: "o1",
        numeroOrden: 1,
        codigoOrden: "CEL-001",
        dispositivo: "iPhone 13",
        marca: "Apple",
        estado: "REPARADO",
        presupuesto: null,
        costoFinal: 200,
      },
      {
        id: "o2",
        numeroOrden: 2,
        codigoOrden: "CEL-002",
        dispositivo: "Notebook HP",
        marca: "HP",
        estado: "RECIBIDO",
        presupuesto: 150,
        costoFinal: null,
      },
    ],
    totales: {
      subtotal: 350,
      totalLote: 315,
      yaCobrado: 0,
      pendienteCobro: 315,
      entregadas: 0,
      pendientes: 2,
    },
    ...overrides,
  }
}

function mockFetchOnce(body: any, ok = true) {
  return vi.fn(() => Promise.resolve({ ok, json: async () => body } as Response))
}

describe("RecepcionDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionMock.role = "ADMIN"
  })

  it("renderiza una fila por orden con badge de estado y presupuesto/costo formateado", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(buildResponse()))

    render(<RecepcionDetail recepcionId="rec-1" />)

    expect(await screen.findByText("CEL-001")).toBeInTheDocument()
    expect(screen.getByText("CEL-002")).toBeInTheDocument()
    expect(screen.getByText("Reparado")).toBeInTheDocument()
    expect(screen.getByText("Recibido")).toBeInTheDocument()
    // o1: costoFinal 200 formateado como moneda (ARS por defecto sin provider)
    expect(screen.getByText(/200/)).toBeInTheDocument()
    // o2: sin costoFinal, cae al presupuesto (150)
    expect(screen.getByText(/150/)).toBeInTheDocument()
  })

  it("muestra subtotal, descuento y total del lote desde el payload de la API", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(buildResponse()))

    render(<RecepcionDetail recepcionId="rec-1" />)

    await screen.findByText("CEL-001")
    expect(screen.getByText(/350/)).toBeInTheDocument() // subtotal
    expect(screen.getByText(/315/)).toBeInTheDocument() // totalLote
    expect(screen.getByText(/10%/)).toBeInTheDocument() // descuento porcentual
  })

  it('deshabilita "Entregar lote" si hay pendientes que no estan Reparado, con texto que explica por que', async () => {
    // o2 pendiente en RECIBIDO (no REPARADO)
    vi.stubGlobal("fetch", mockFetchOnce(buildResponse()))

    render(<RecepcionDetail recepcionId="rec-1" />)

    const btn = await screen.findByRole("button", { name: /entregar lote/i })
    expect(btn).toBeDisabled()
    expect(screen.getByText(/deben estar.*reparado/i)).toBeInTheDocument()
  })

  it('habilita "Entregar lote" cuando todos los pendientes estan Reparado', async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchOnce(
        buildResponse({
          ordenes: [
            {
              id: "o1",
              numeroOrden: 1,
              codigoOrden: "CEL-001",
              dispositivo: "iPhone 13",
              marca: "Apple",
              estado: "REPARADO",
              presupuesto: null,
              costoFinal: 200,
            },
            {
              id: "o2",
              numeroOrden: 2,
              codigoOrden: "CEL-002",
              dispositivo: "Notebook HP",
              marca: "HP",
              estado: "REPARADO",
              presupuesto: 150,
              costoFinal: 150,
            },
          ],
          totales: { subtotal: 350, totalLote: 315, yaCobrado: 0, pendienteCobro: 315, entregadas: 0, pendientes: 2 },
        }),
      ),
    )

    render(<RecepcionDetail recepcionId="rec-1" />)

    const btn = await screen.findByRole("button", { name: /entregar lote/i })
    expect(btn).not.toBeDisabled()
  })

  it("oculta el editor de descuento cuando totales.entregadas > 0", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchOnce(
        buildResponse({
          totales: { subtotal: 350, totalLote: 315, yaCobrado: 200, pendienteCobro: 115, entregadas: 1, pendientes: 1 },
        }),
      ),
    )

    render(<RecepcionDetail recepcionId="rec-1" />)

    await screen.findByText("CEL-001")
    expect(screen.queryByRole("button", { name: /guardar/i })).not.toBeInTheDocument()
  })

  it("al guardar el descuento hace PATCH a /api/recepciones/[id] y refresca", async () => {
    const getResponse = buildResponse()
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => getResponse } as Response)
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<RecepcionDetail recepcionId="rec-1" />)

    await screen.findByText("CEL-001")

    const valorInput = screen.getByLabelText(/descuento/i)
    fireEvent.change(valorInput, { target: { value: "15" } })
    fireEvent.click(screen.getByRole("button", { name: /guardar/i }))

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === "PATCH")
      expect(patchCall).toBeTruthy()
      const body = JSON.parse((patchCall![1] as RequestInit).body as string)
      expect(body).toMatchObject({ descuentoTipo: "porcentaje", descuentoValor: 15 })
    })

    // Refetch: al menos 2 GETs (inicial + post-guardado)
    const getCalls = fetchMock.mock.calls.filter(([, init]) => !init || (init as RequestInit)?.method === undefined)
    expect(getCalls.length).toBeGreaterThanOrEqual(2)
  })

  it('"Entregar lote" abre el dialogo de entrega con los equipos pendientes', async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchOnce(
        buildResponse({
          ordenes: [
            {
              id: "o1",
              numeroOrden: 1,
              codigoOrden: "CEL-001",
              dispositivo: "iPhone 13",
              marca: "Apple",
              estado: "REPARADO",
              presupuesto: null,
              costoFinal: 200,
            },
            {
              id: "o2",
              numeroOrden: 2,
              codigoOrden: "CEL-002",
              dispositivo: "Notebook HP",
              marca: "HP",
              estado: "REPARADO",
              presupuesto: 150,
              costoFinal: 150,
            },
          ],
          totales: { subtotal: 350, totalLote: 315, yaCobrado: 0, pendienteCobro: 315, entregadas: 0, pendientes: 2 },
        }),
      ),
    )

    render(<RecepcionDetail recepcionId="rec-1" />)

    const btn = await screen.findByRole("button", { name: /entregar lote/i })
    fireEvent.click(btn)

    expect(await screen.findByRole("button", { name: /confirmar entrega/i })).toBeInTheDocument()
  })

  it("al confirmar la entrega del lote desde el dialogo, refresca el detalle", async () => {
    const getResponse = buildResponse({
      ordenes: [
        {
          id: "o1",
          numeroOrden: 1,
          codigoOrden: "CEL-001",
          dispositivo: "iPhone 13",
          marca: "Apple",
          estado: "REPARADO",
          presupuesto: null,
          costoFinal: 200,
        },
        {
          id: "o2",
          numeroOrden: 2,
          codigoOrden: "CEL-002",
          dispositivo: "Notebook HP",
          marca: "HP",
          estado: "REPARADO",
          presupuesto: 150,
          costoFinal: 150,
        },
      ],
      totales: { subtotal: 350, totalLote: 315, yaCobrado: 0, pendienteCobro: 315, entregadas: 0, pendientes: 2 },
    })
    const fetchMock = vi.fn((url: string) => {
      if (typeof url === "string" && url.includes("/entregar")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ recepcionId: "rec-1", totalCobrado: 315, ordenes: [] }),
        } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => getResponse } as Response)
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<RecepcionDetail recepcionId="rec-1" />)

    const btn = await screen.findByRole("button", { name: /entregar lote/i })
    fireEvent.click(btn)

    fireEvent.click(await screen.findByRole("radio", { name: /efectivo/i }))
    fireEvent.click(screen.getByRole("button", { name: /confirmar entrega/i }))

    await waitFor(() => {
      const getCalls = fetchMock.mock.calls.filter(
        ([url]) => typeof url === "string" && url.includes("/api/recepciones/rec-1") && !url.includes("/entregar"),
      )
      // Inicial + refetch post-entrega
      expect(getCalls.length).toBeGreaterThanOrEqual(2)
    })
  })

  it('habilita "Entregar lote" aunque un equipo del lote este CANCELADO (queda fuera del lote, no lo bloquea)', async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchOnce(
        buildResponse({
          ordenes: [
            orden({ id: "o1", numeroOrden: 1, codigoOrden: "CEL-001", estado: "REPARADO" }),
            orden({ id: "o2", numeroOrden: 2, codigoOrden: "CEL-002", estado: "CANCELADO", costoFinal: null, presupuesto: 150 }),
          ],
          totales: { subtotal: 200, totalLote: 180, yaCobrado: 0, pendienteCobro: 180, entregadas: 0, pendientes: 1 },
        }),
      ),
    )

    render(<RecepcionDetail recepcionId="rec-1" />)

    const btn = await screen.findByRole("button", { name: /entregar lote/i })
    expect(btn).not.toBeDisabled()
    // El cancelado no cuenta como equipo del lote en el progreso.
    expect(screen.getByText(/0 de 1 entregados/i)).toBeInTheDocument()
  })

  it('deshabilita "Entregar lote" cuando todos los pendientes quedaron excluidos del lote', async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchOnce(
        buildResponse({
          ordenes: [
            orden({ id: "o1", numeroOrden: 1, codigoOrden: "CEL-001", estado: "CANCELADO" }),
            orden({ id: "o2", numeroOrden: 2, codigoOrden: "CEL-002", estado: "SIN_REPARACION" }),
          ],
          totales: { subtotal: 0, totalLote: 0, yaCobrado: 0, pendienteCobro: 0, entregadas: 0, pendientes: 0 },
        }),
      ),
    )

    render(<RecepcionDetail recepcionId="rec-1" />)

    const btn = await screen.findByRole("button", { name: /entregar lote/i })
    expect(btn).toBeDisabled()
    expect(screen.getByText(/no quedan equipos pendientes/i)).toBeInTheDocument()
  })

  it("el dialogo de entrega recibe lo ya cobrado: muestra el mismo total que va a cobrar el servidor", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchOnce(
        buildResponse({
          ordenes: [
            orden({ id: "o1", numeroOrden: 1, codigoOrden: "CEL-001", estado: "ENTREGADO", costoFinal: 300 }),
            orden({ id: "o2", numeroOrden: 2, codigoOrden: "CEL-002", estado: "REPARADO", costoFinal: 100 }),
            orden({ id: "o3", numeroOrden: 3, codigoOrden: "CEL-003", estado: "REPARADO", costoFinal: 200 }),
            orden({ id: "o4", numeroOrden: 4, codigoOrden: "CEL-004", estado: "REPARADO", costoFinal: 300 }),
          ],
          totales: { subtotal: 900, totalLote: 810, yaCobrado: 280, pendienteCobro: 530, entregadas: 1, pendientes: 3 },
        }),
      ),
    )

    render(<RecepcionDetail recepcionId="rec-1" />)

    fireEvent.click(await screen.findByRole("button", { name: /entregar lote/i }))

    // Acotado al dialogo: la card de totales de la pantalla ya muestra el
    // pendiente, y sin acotar el assert pasaria sin que el dialogo se entere.
    const dialogo = within(await screen.findByRole("dialog"))
    // 600 pendientes + 300 ya entregados = 900, -10% = 810, -280 ya cobrados = 530
    expect(dialogo.getByText(/530,00/)).toBeInTheDocument()
    expect(dialogo.queryByText(/540,00/)).not.toBeInTheDocument()
  })

  it('oculta "Entregar lote" para un usuario que no es ADMIN', async () => {
    sessionMock.role = "VENDEDOR"
    vi.stubGlobal("fetch", mockFetchOnce(buildResponse()))

    render(<RecepcionDetail recepcionId="rec-1" />)

    await screen.findByText("CEL-001")
    expect(screen.queryByRole("button", { name: /entregar lote/i })).not.toBeInTheDocument()
  })

  it("muestra ya cobrado y pendiente de cobro solo cuando hay equipos entregados", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(buildResponse()))

    const { unmount } = render(<RecepcionDetail recepcionId="rec-1" />)
    await screen.findByText("CEL-001")
    expect(screen.queryByText(/ya cobrado/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/pendiente de cobro/i)).not.toBeInTheDocument()
    unmount()

    vi.stubGlobal(
      "fetch",
      mockFetchOnce(
        buildResponse({
          totales: { subtotal: 350, totalLote: 315, yaCobrado: 200, pendienteCobro: 115, entregadas: 1, pendientes: 1 },
        }),
      ),
    )

    render(<RecepcionDetail recepcionId="rec-1" />)
    await screen.findByText("CEL-001")
    expect(screen.getByText(/ya cobrado/i)).toBeInTheDocument()
    expect(screen.getByText(/pendiente de cobro/i)).toBeInTheDocument()
    expect(screen.getByText(/115/)).toBeInTheDocument()
  })
})
