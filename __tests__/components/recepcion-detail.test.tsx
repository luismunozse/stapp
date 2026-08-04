// __tests__/components/recepcion-detail.test.tsx
//
// RecepcionDetail — vista de detalle de un lote de recepcion multiple.
// Mockea fetch (GET/PATCH /api/recepciones/[id]) y useSession (ADMIN), igual
// que entrega-dialog-total.test.tsx hace para componentes que dependen de
// next-auth sin montar el SessionProvider real.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { RecepcionDetail } from "@/components/ordenes/recepcion-detail"

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { role: "ADMIN" } } }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

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
          totales: { subtotal: 350, totalLote: 315, entregadas: 0, pendientes: 2 },
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
      mockFetchOnce(buildResponse({ totales: { subtotal: 350, totalLote: 315, entregadas: 1, pendientes: 1 } })),
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
})
