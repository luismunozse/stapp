import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"

const { data, mutate, confirm, swrKeys } = vi.hoisted(() => ({
  data: { value: null as any },
  mutate: vi.fn(),
  confirm: vi.fn(),
  swrKeys: [] as Array<string | null>,
}))

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("swr", () => ({
  default: (key: string | null) => {
    swrKeys.push(key)
    if (key === "/api/operadores") {
      return { data: [{ id: "v1", nombre: "Vera", rol: "VENDEDOR" }], isLoading: false, error: undefined, mutate }
    }
    return {
      data: key?.startsWith("/api/comisiones?") ? data.value : [],
      isLoading: false,
      error: undefined,
      mutate,
    }
  },
}))
vi.mock("@/contexts/modal-context", () => ({ useModal: () => ({ confirm }) }))
vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}`, formatDate: (d: string) => `fmt(${d})` }),
}))

import { ComisionesView } from "@/components/comisiones/comisiones-view"

function item(over: Record<string, unknown> = {}) {
  return {
    clave: "k",
    ordenId: "o1",
    tecnicoId: "v1",
    tecnicoNombre: "Vera",
    rol: "RECEPCION",
    tipo: "ORIGINAL",
    pagoId: null,
    pendiente: 0,
    codigoOrden: "OR-1",
    numeroOrden: 1,
    dispositivo: "Equipo",
    estado: "ENTREGADO",
    fechaCompletado: null,
    costoFinal: 0,
    costoRepuestos: 0,
    ganancia: 0,
    porcentajeComision: 5,
    montoComision: 10,
    comisionPagada: false,
    fechaPagoComision: null,
    ...over,
  }
}

describe("ComisionesView reception tab", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    swrKeys.length = 0
  })

  it("reads reception rows, lists people from /api/operadores and pays one person", async () => {
    confirm.mockResolvedValue(true)
    data.value = {
      items: [item({ clave: "a", codigoOrden: "a" }), item({ clave: "b", codigoOrden: "b", ordenId: "o2", montoComision: 20 })],
      resumen: [],
    }
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ pagoId: "p1", total: 30, filas: 2 }) }) as any
    render(<ComisionesView rol="RECEPCION" />)

    expect(swrKeys.some((k) => k?.startsWith("/api/comisiones?") && k.includes("rol=RECEPCION"))).toBe(true)
    expect(swrKeys).toContain("/api/operadores")
    expect(screen.getAllByText("Persona").length).toBeGreaterThan(0)
    expect(screen.queryByText("Técnico")).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByLabelText("Seleccionar comisión a")[0])
    fireEvent.click(screen.getAllByLabelText("Seleccionar comisión b")[0])
    fireEvent.click(screen.getByRole("button", { name: /Marcar como pagadas/ }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const [url, init] = (global.fetch as any).mock.calls[0]
    expect(url).toBe("/api/comisiones/pagar")
    expect(JSON.parse(init.body)).toEqual({
      beneficiarioId: "v1",
      filas: [{ clave: "a", monto: 10 }, { clave: "b", monto: 20 }],
    })
  })

  it("shows where to set the rate when there is nothing to list", () => {
    data.value = { items: [], resumen: [] }
    render(<ComisionesView rol="RECEPCION" />)
    expect(screen.getByText("Sin comisiones de recepción")).toBeInTheDocument()
    expect(screen.getByText(/Configuración › Comisiones/)).toBeInTheDocument()
  })

  it("the technician tab still asks rol=TECNICO and keeps the technician people source", () => {
    data.value = { items: [], resumen: [] }
    render(<ComisionesView />)
    expect(swrKeys.some((k) => k?.startsWith("/api/comisiones?") && k.includes("rol=TECNICO"))).toBe(true)
    expect(swrKeys).toContain("/api/tecnicos")
    expect(swrKeys).not.toContain("/api/operadores")
    expect(screen.getByText("Técnico")).toBeInTheDocument()
    expect(screen.getByText("Sin comisiones")).toBeInTheDocument()
  })

  it("labels the amount base as Base on both roles and badges order credit notes", () => {
    data.value = {
      items: [item({ clave: "n", codigoOrden: "n", tipo: "AJUSTE_DEVOLUCION", montoComision: -5, ganancia: 100 })],
      resumen: [{ tecnicoId: "v1", tecnicoNombre: "Vera", totalOrdenes: 1, totalGanancia: 100, totalComision: -5, totalPendiente: -5 }],
    }
    render(<ComisionesView />)
    expect(screen.getAllByText("Base").length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText("Ganancia")).not.toBeInTheDocument()
    expect(screen.getAllByText("Nota de crédito").length).toBeGreaterThan(0)
  })
})
