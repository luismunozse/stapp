// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react"
import { DevolucionForm } from "@/components/ventas/devolucion-form"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}` }),
}))
vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ showError: vi.fn(), showSuccess: vi.fn().mockResolvedValue(undefined) }),
}))

const items = [
  { id: "iv1", inventarioId: "inv1", descripcion: "Teclado", cantidad: 1, precioUnitario: 200 },
  { id: "iv2", inventarioId: "inv2", descripcion: "Mouse", cantidad: 2, precioUnitario: 50 },
]

describe("DevolucionForm — saldo pendiente y devoluciones previas", () => {
  beforeEach(() => vi.unstubAllGlobals())

  it("descuenta primero lo que el cliente debe y reembolsa solo el resto", () => {
    render(
      <DevolucionForm
        open
        onOpenChange={() => {}}
        venta={{ id: "v1", numeroVenta: 1, total: 300, clienteId: "c1", saldoPendiente: 150, items }}
        onSuccess={() => {}}
      />
    )

    fireEvent.click(screen.getByRole("checkbox", { name: /devolver teclado/i }))

    expect(screen.getByText("Se descuenta del saldo pendiente:").closest("div")).toHaveTextContent("-$150")
    const total = screen.getByText("Total a reembolsar:").closest("div") as HTMLElement
    expect(within(total).getByText("$50")).toBeInTheDocument()
  })

  it("no ofrece lo ya devuelto y limita la cantidad a lo que queda", () => {
    render(
      <DevolucionForm
        open
        onOpenChange={() => {}}
        venta={{
          id: "v1",
          numeroVenta: 1,
          total: 300,
          items,
          devoluciones: [{ montoDevolucion: 250, items: [{ itemVentaId: "iv1", cantidad: 1 }, { itemVentaId: "iv2", cantidad: 1 }] }],
        }}
        onSuccess={() => {}}
      />
    )

    expect(screen.getByRole("checkbox", { name: /devolver teclado/i })).toBeDisabled()
    fireEvent.click(screen.getByRole("checkbox", { name: /devolver mouse/i }))
    expect(screen.getByText("Máximo: 1")).toBeInTheDocument()
  })

  it("sin cliente no ofrece cuenta corriente, y 'crédito en tienda' ya no existe", () => {
    render(
      <DevolucionForm
        open
        onOpenChange={() => {}}
        venta={{ id: "v1", numeroVenta: 1, total: 300, items }}
        onSuccess={() => {}}
      />
    )
    fireEvent.click(screen.getByRole("checkbox", { name: /devolver teclado/i }))

    const select = screen.getByLabelText(/método de reembolso/i)
    const opciones = within(select).getAllByRole("option").map((o) => o.getAttribute("value"))
    expect(opciones).not.toContain("CREDITO_TIENDA")
    expect(opciones).not.toContain("CUENTA_CORRIENTE")
  })

  it("doble click registra una sola devolución y manda clave de idempotencia", async () => {
    let resolver: (v: unknown) => void = () => {}
    const fetchMock = vi.fn(
      () => new Promise((r) => { resolver = r })
    )
    vi.stubGlobal("fetch", fetchMock)
    const onSuccess = vi.fn()
    render(
      <DevolucionForm
        open
        onOpenChange={() => {}}
        venta={{ id: "v1", numeroVenta: 1, total: 300, items }}
        onSuccess={onSuccess}
      />
    )

    fireEvent.click(screen.getByRole("checkbox", { name: /devolver teclado/i }))
    fireEvent.change(screen.getByLabelText(/motivo/i), { target: { value: "Falla" } })
    const boton = screen.getByRole("button", { name: /registrar devolución/i })
    fireEvent.click(boton)
    fireEvent.click(boton)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const enviado = JSON.parse((fetchMock.mock.calls[0] as any)[1].body)
    expect(enviado.idempotencyKey).toEqual(expect.any(String))
    expect(enviado.items[0]).not.toHaveProperty("inventarioId")

    resolver({ ok: true, json: async () => ({ id: "d1" }) })
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
