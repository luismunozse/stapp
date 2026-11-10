import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"

const { data, mutate, confirm, swrError } = vi.hoisted(() => ({ data: { value: null as any }, mutate: vi.fn(), confirm: vi.fn(), swrError: { value: undefined as any } }))

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("swr", () => ({
  default: (key: string | null) => ({
    data: key?.startsWith("/api/comisiones?") ? data.value : [],
    isLoading: false,
    error: key?.startsWith("/api/comisiones?") ? swrError.value : undefined,
    mutate,
  }),
}))
vi.mock("@/contexts/modal-context", () => ({ useModal: () => ({ confirm }) }))
vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({
    formatPrice: (n: number) => `$${n}`,
    formatDate: (d: string) => `fmt(${d})`,
  }),
}))

import { toast } from "sonner"
import { ComisionesView } from "@/components/comisiones/comisiones-view"

function item(over: Record<string, unknown> = {}) {
  return {
    clave: "k",
    ordenId: "o1",
    tecnicoId: "t1",
    tecnicoNombre: "Ana",
    rol: "TECNICO",
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
    porcentajeComision: 10,
    montoComision: 0,
    comisionPagada: false,
    fechaPagoComision: null,
    ...over,
  }
}

// Desktop table and mobile cards both render in jsdom; the first match is the table one.
const selectRow = (clave: string) =>
  fireEvent.click(screen.getAllByLabelText(`Seleccionar comisión ${clave}`)[0])

describe("ComisionesView paying and annulling payouts", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    confirm.mockResolvedValue(true)
    swrError.value = undefined
  })

  it("blocks paying a selection that spans two technicians", async () => {
    data.value = { items: [item({ clave: "a", codigoOrden: "a", tecnicoId: "t1", montoComision: 10 }), item({ clave: "b", codigoOrden: "b", ordenId: "o2", tecnicoId: "t2", montoComision: 10 })], resumen: [] }
    render(<ComisionesView />)
    selectRow("a")
    selectRow("b")
    expect(screen.getByText("Elegí comisiones de una sola persona para pagarlas juntas.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Marcar como pagadas/ })).toBeDisabled()
  })

  it("pays one technician's rows with their displayed amounts", async () => {
    data.value = { items: [item({ clave: "a", codigoOrden: "a", tecnicoId: "t1", montoComision: 100 }), item({ clave: "b", codigoOrden: "b", ordenId: "o2", tecnicoId: "t1", montoComision: 50 })], resumen: [] }
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ pagoId: "p1", total: 150, filas: 2 }) }) as any
    render(<ComisionesView />)
    selectRow("a")
    selectRow("b")
    fireEvent.click(screen.getByRole("button", { name: /Marcar como pagadas/ }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const [url, init] = (global.fetch as any).mock.calls[0]
    expect(url).toBe("/api/comisiones/pagar")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({
      beneficiarioId: "t1",
      filas: [{ clave: "a", monto: 100 }, { clave: "b", monto: 50 }],
    })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Comisiones marcadas como pagadas"))
    expect(mutate).toHaveBeenCalled()
  })

  it("on 409 shows the server message and reloads", async () => {
    const msg = "Las comisiones cambiaron desde que las viste. Actualizá y probá de nuevo."
    data.value = { items: [item({ clave: "a", codigoOrden: "a", tecnicoId: "t1", montoComision: 100 })], resumen: [] }
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: msg }) }) as any
    render(<ComisionesView />)
    selectRow("a")
    fireEvent.click(screen.getByRole("button", { name: /Marcar como pagadas/ }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(msg))
    expect(mutate).toHaveBeenCalled()
  })

  it("clicking a paid row opens the annul dialog for its payout", async () => {
    data.value = { items: [item({ clave: "a", codigoOrden: "a", comisionPagada: true, pagoId: "p9", fechaPagoComision: "2026-10-20T12:00:00Z" })], resumen: [] }
    render(<ComisionesView />)
    expect(screen.queryByText("Anular pago")).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByRole("button", { name: /Pagada/ })[0])
    expect(await screen.findByText("Anular pago", { selector: "h2" })).toBeInTheDocument()
  })

  it("drops rows that became paid meanwhile from the selection, count and body", async () => {
    data.value = { items: [item({ clave: "a", codigoOrden: "a", montoComision: 100 }), item({ clave: "b", codigoOrden: "b", ordenId: "o2", montoComision: 50 })], resumen: [] }
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ pagoId: "p1", total: 50, filas: 1 }) }) as any
    const { rerender } = render(<ComisionesView />)
    selectRow("a")
    selectRow("b")
    expect(screen.getByText("2")).toBeInTheDocument()
    data.value = { items: [item({ clave: "a", codigoOrden: "a", montoComision: 100, comisionPagada: true, pagoId: "p0", fechaPagoComision: "2026-10-20T12:00:00Z" }), item({ clave: "b", codigoOrden: "b", ordenId: "o2", montoComision: 50 })], resumen: [] }
    rerender(<ComisionesView />)
    expect(screen.getByText("1")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Marcar como pagadas/ }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(JSON.parse((global.fetch as any).mock.calls[0][1].body)).toEqual({ beneficiarioId: "t1", filas: [{ clave: "b", monto: 50 }] })
  })

  it("labels adjustment checkboxes with the kind so they differ from the original", async () => {
    data.value = { items: [item({ clave: "a", codigoOrden: "OR-7" }), item({ clave: "b", codigoOrden: "OR-7", tipo: "AJUSTE_DEVOLUCION", montoComision: -5 })], resumen: [] }
    render(<ComisionesView />)
    expect(screen.getAllByLabelText("Seleccionar comisión OR-7")).toHaveLength(2)
    expect(screen.getAllByLabelText("Seleccionar comisión OR-7 (Nota de crédito)")).toHaveLength(2)
  })

  it("renders a dash instead of the order link when the row has no order, and badges adjustments", async () => {
    data.value = { items: [item({ clave: "a", codigoOrden: "a", ordenId: null, tipo: "AJUSTE_DEVOLUCION", montoComision: -20 })], resumen: [] }
    render(<ComisionesView />)
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
    expect(screen.getAllByText("—").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Nota de crédito").length).toBeGreaterThan(0)
  })

  it("lists a zero-amount row but cannot select it, and never posts it", async () => {
    data.value = { items: [item({ clave: "a", codigoOrden: "a", montoComision: 100 }), item({ clave: "z", codigoOrden: "z", ordenId: "o3", montoComision: 0 })], resumen: [] }
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ pagoId: "p1", total: 100, filas: 1 }) }) as any
    render(<ComisionesView />)
    expect(screen.getAllByText("z").length).toBeGreaterThan(0)
    expect(screen.getAllByLabelText("Seleccionar comisión z")[0]).toBeDisabled()
    fireEvent.click(screen.getAllByLabelText("Seleccionar todas las pendientes")[0])
    expect(screen.getByText("1")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Marcar como pagadas/ }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(JSON.parse((global.fetch as any).mock.calls[0][1].body)).toEqual({ beneficiarioId: "t1", filas: [{ clave: "a", monto: 100 }] })
  })

  it("says plainly when the selected total is negative", async () => {
    data.value = { items: [item({ clave: "n", codigoOrden: "n", tipo: "AJUSTE_DEVOLUCION", montoComision: -30 })], resumen: [] }
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ pagoId: "p1", total: -30, filas: 1 }) }) as any
    render(<ComisionesView />)
    fireEvent.click(screen.getAllByLabelText(/Seleccionar comisión n/)[0])
    fireEvent.click(screen.getByRole("button", { name: /Marcar como pagadas/ }))
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(confirm.mock.calls[0][0].description).toBe("El total es negativo ($-30): se registra como descuento a favor del taller. ¿Confirmás?")
  })

  it("shows an error line, not an empty state, when the read fails", async () => {
    data.value = undefined
    swrError.value = new Error("boom")
    render(<ComisionesView />)
    expect(screen.getByText("No se pudieron cargar las comisiones.")).toBeInTheDocument()
    expect(screen.queryByText("Sin comisiones")).not.toBeInTheDocument()
  })
  describe("what the base was taken from", () => {
    const tecnico = () => item({ clave: "t", codigoOrden: "OR-1", costoFinal: 1000, costoRepuestos: 200, montoOrden: 850, baseTipo: "MANO_DE_OBRA", ganancia: 650 })
    const recepcion = () => item({ clave: "r", rol: "RECEPCION", codigoOrden: "OR-2", ordenId: "o2", costoFinal: 1000, costoRepuestos: 200, montoOrden: 850, baseTipo: "MONTO_ORDEN", ganancia: 850 })

    it("desktop: shows Desc./NC and Repuestos for a labour base, a dash for parts on an order-amount base", () => {
      data.value = { items: [tecnico(), recepcion()], resumen: [] }
      render(<ComisionesView />)
      const [, tec, rec] = screen.getAllByRole("row")
      expect(tec).toHaveTextContent("$1000")
      expect(tec).toHaveTextContent("$150")
      expect(tec).toHaveTextContent("$200")
      expect(tec).toHaveTextContent("$650")
      expect(rec).toHaveTextContent("$150")
      expect(rec).not.toHaveTextContent("$200")
      expect(rec).toHaveTextContent("$850")
      expect(screen.getByRole("columnheader", { name: "Desc./NC" })).toBeInTheDocument()
    })

    it("mobile: lists Desc./NC and lists Repuestos only for the labour base", () => {
      data.value = { items: [tecnico(), recepcion()], resumen: [] }
      const { container } = render(<ComisionesView />)
      const cards = container.querySelectorAll(".sm\\:hidden .p-3")
      expect(cards[0]).toHaveTextContent("Desc./NC $150")
      expect(cards[0]).toHaveTextContent("Repuestos $200")
      expect(cards[0]).toHaveTextContent("Base $650")
      expect(cards[1]).toHaveTextContent("Desc./NC $150")
      expect(cards[1]).not.toHaveTextContent("Repuestos")
      expect(cards[1]).toHaveTextContent("Base $850")
    })

    it("a paid row shows only its frozen base, with dashes for the costs", () => {
      data.value = { items: [{ ...tecnico(), comisionPagada: true, pagoId: "p9", fechaPagoComision: "2026-10-20T12:00:00Z" }], resumen: [] }
      const { container } = render(<ComisionesView />)
      const [, row] = screen.getAllByRole("row")
      expect(row).not.toHaveTextContent("$1000")
      expect(row).not.toHaveTextContent("$200")
      expect(row).toHaveTextContent("$650")
      const card = container.querySelector(".sm\\:hidden .p-3")!
      expect(card).not.toHaveTextContent("Desc./NC")
      expect(card).toHaveTextContent("Base $650")
    })
  })
})
