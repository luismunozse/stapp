import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"

const { data, liquidarData, mutate, showError } = vi.hoisted(() => ({
  data: { value: null as any },
  liquidarData: { value: null as any },
  mutate: vi.fn(),
  showError: vi.fn(),
}))

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("swr", () => ({
  default: (key: string | null) => {
    if (key?.startsWith("/api/comisiones/vendedores?")) return { data: data.value, isLoading: false, mutate }
    if (key?.includes("/comisiones?estado=")) return { data: liquidarData.value, isLoading: false, mutate }
    return { data: { data: [] }, isLoading: false, mutate }
  },
}))
vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ confirm: vi.fn().mockResolvedValue(true), showError }),
}))
vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({
    formatPrice: (n: number) => `$${n}`,
    formatDate: (d: string) => `fmt(${d})`,
  }),
}))

import { toast } from "sonner"
import { ComisionesVendedoresView } from "@/components/comisiones/comisiones-vendedores-view"
import { LiquidarComisionesDialog } from "@/components/vendedores/liquidar-comisiones-dialog"

function item(over: Record<string, unknown> = {}) {
  return {
    clave: "k",
    ventaId: "v1",
    vendedorId: "s1",
    vendedorNombre: "Ana",
    tipo: "ORIGINAL",
    pagoId: null,
    pendiente: 0,
    numeroVenta: 1,
    clienteNombre: "Cliente",
    fecha: "2026-10-01T00:00:00Z",
    total: 0,
    porcentajeComision: 10,
    montoComision: 0,
    comisionPagada: false,
    fechaPagoComision: null,
    ...over,
  }
}

// Desktop table and mobile cards both render in jsdom; the first match is the table one.
const selectRow = (label: string) => fireEvent.click(screen.getAllByLabelText(label)[0])

describe("ComisionesVendedoresView paying and annulling payouts", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("an adjustment row shows 'Devolución' and a negative amount, and nets the selected total", async () => {
    data.value = {
      items: [
        item({ clave: "a", numeroVenta: 5, montoComision: 100 }),
        item({ clave: "b", numeroVenta: 5, tipo: "AJUSTE_DEVOLUCION", montoComision: -30 }),
      ],
      resumen: [],
    }
    render(<ComisionesVendedoresView />)
    expect(screen.getAllByText("Devolución").length).toBeGreaterThan(0)
    expect(screen.getAllByText("$-30").length).toBeGreaterThan(0)
    fireEvent.click(screen.getByLabelText("Seleccionar todas las pendientes"))
    expect(screen.getByText("$70")).toBeInTheDocument()
  })

  it("blocks a two-seller selection", async () => {
    data.value = {
      items: [
        item({ clave: "a", numeroVenta: 1, vendedorId: "s1", montoComision: 10 }),
        item({ clave: "b", numeroVenta: 2, ventaId: "v2", vendedorId: "s2", montoComision: 20 }),
      ],
      resumen: [],
    }
    render(<ComisionesVendedoresView />)
    selectRow("Seleccionar comisión #1")
    selectRow("Seleccionar comisión #2")
    expect(screen.getByText("Elegí comisiones de un solo vendedor para pagarlas juntas.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Marcar como pagadas/ })).toBeDisabled()
  })

  it("pays the selected rows with their amounts", async () => {
    data.value = {
      items: [
        item({ clave: "a", numeroVenta: 1, montoComision: 100 }),
        item({ clave: "b", numeroVenta: 2, ventaId: "v2", montoComision: 50 }),
      ],
      resumen: [],
    }
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ pagoId: "p1" }) }) as any
    render(<ComisionesVendedoresView />)
    selectRow("Seleccionar comisión #1")
    selectRow("Seleccionar comisión #2")
    fireEvent.click(screen.getByRole("button", { name: /Marcar como pagadas/ }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const [url, init] = (global.fetch as any).mock.calls[0]
    expect(url).toBe("/api/comisiones/vendedores/pagar")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({
      beneficiarioId: "s1",
      filas: [{ clave: "a", monto: 100 }, { clave: "b", monto: 50 }],
    })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Comisiones marcadas como pagadas"))
    expect(mutate).toHaveBeenCalled()
  })

  it("on a non-OK answer shows the server message and reloads", async () => {
    const msg = "Las comisiones cambiaron desde que las viste. Actualizá y probá de nuevo."
    data.value = { items: [item({ clave: "a", numeroVenta: 1, montoComision: 100 })], resumen: [] }
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: msg }) }) as any
    render(<ComisionesVendedoresView />)
    selectRow("Seleccionar comisión #1")
    fireEvent.click(screen.getByRole("button", { name: /Marcar como pagadas/ }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(msg))
    expect(mutate).toHaveBeenCalled()
  })

  it("clicking a paid row opens the annul dialog for its payout", async () => {
    data.value = {
      items: [item({ clave: "a", comisionPagada: true, pagoId: "p9", fechaPagoComision: "2026-10-20T12:00:00Z" })],
      resumen: [],
    }
    render(<ComisionesVendedoresView />)
    expect(screen.queryByText("Anular pago")).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByRole("button", { name: /Pagada/ })[0])
    expect(await screen.findByText("Anular pago", { selector: "h2" })).toBeInTheDocument()
  })

  it("renders a dash instead of the sale link when the row has no sale", async () => {
    data.value = { items: [item({ clave: "a", ventaId: null, tipo: "AJUSTE_DEVOLUCION", montoComision: -20 })], resumen: [] }
    render(<ComisionesVendedoresView />)
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
    expect(screen.getAllByText("—").length).toBeGreaterThan(0)
  })

  it("drops rows that became paid meanwhile from the selection and the body", async () => {
    data.value = {
      items: [
        item({ clave: "a", numeroVenta: 1, montoComision: 100 }),
        item({ clave: "b", numeroVenta: 2, ventaId: "v2", montoComision: 50 }),
      ],
      resumen: [],
    }
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ pagoId: "p1" }) }) as any
    const { rerender } = render(<ComisionesVendedoresView />)
    selectRow("Seleccionar comisión #1")
    selectRow("Seleccionar comisión #2")
    data.value = {
      items: [
        item({ clave: "a", numeroVenta: 1, montoComision: 100, comisionPagada: true, pagoId: "p0", fechaPagoComision: "2026-10-20T12:00:00Z" }),
        item({ clave: "b", numeroVenta: 2, ventaId: "v2", montoComision: 50 }),
      ],
      resumen: [],
    }
    rerender(<ComisionesVendedoresView />)
    fireEvent.click(screen.getByRole("button", { name: /Marcar como pagadas/ }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(JSON.parse((global.fetch as any).mock.calls[0][1].body)).toEqual({
      beneficiarioId: "s1",
      filas: [{ clave: "b", monto: 50 }],
    })
  })
})

describe("LiquidarComisionesDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    liquidarData.value = {
      comisiones: [
        { clave: "a", ventaId: "va", tipo: "ORIGINAL", numeroVenta: 1, clienteNombre: "C1", fecha: "2026-10-01", total: 1000, porcentajeComision: 10, montoComision: 100, pagada: false },
        { clave: "b", ventaId: "va", tipo: "AJUSTE_DEVOLUCION", numeroVenta: 1, clienteNombre: "C1", fecha: "2026-10-02", total: 0, porcentajeComision: 10, montoComision: -30, pagada: false },
      ],
      totales: { devengada: 70, pagada: 0, pendiente: 70 },
    }
  })

  const renderDialog = (onLiquidated = vi.fn()) =>
    render(
      <LiquidarComisionesDialog open onOpenChange={vi.fn()} vendedorId="v1" vendedorNombre="Ana" onLiquidated={onLiquidated} />
    )

  it("posts every preselected row with its amount", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ pagoId: "p1" }) }) as any
    const onLiquidated = vi.fn()
    renderDialog(onLiquidated)
    expect(screen.getByText("Devolución")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /^Liquidar/ }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const [url, init] = (global.fetch as any).mock.calls[0]
    expect(url).toBe("/api/vendedores/v1/comisiones/liquidar")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({
      filas: [{ clave: "a", monto: 100 }, { clave: "b", monto: -30 }],
    })
    await waitFor(() => expect(onLiquidated).toHaveBeenCalled())
  })

  it("on a non-OK answer shows body.error and reloads", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "cambiaron" }) }) as any
    const onLiquidated = vi.fn()
    renderDialog(onLiquidated)
    fireEvent.click(screen.getByRole("button", { name: /^Liquidar/ }))
    await waitFor(() => expect(showError).toHaveBeenCalledWith("cambiaron"))
    expect(mutate).toHaveBeenCalled()
    expect(onLiquidated).not.toHaveBeenCalled()
  })
})
