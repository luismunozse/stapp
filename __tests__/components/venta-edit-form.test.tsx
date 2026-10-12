// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { VentaEditForm } from "@/components/ventas/venta-edit-form"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}` }),
}))
const showError = vi.fn()
const showSuccess = vi.fn()
vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ showError, showSuccess }),
}))

function stubFetch() {
  const calls: Array<{ url: string; method: string; body: any }> = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body as string) : null })
      if (url.startsWith("/api/configuracion/operativa")) {
        return { ok: true, json: async () => ({ ivaRegimen: "EXENTO", ivaTasa: 21, redondeoEfectivo: 0 }) }
      }
      if (url.startsWith("/api/clientes")) {
        return { ok: true, json: async () => ({ data: [{ id: "c9", nombre: "Carla", telefono: "999" }] }) }
      }
      return { ok: true, json: async () => ({ id: "v1" }) }
    })
  )
  return calls
}

// Venta de $1.000 con $100 de descuento en la línea y $30 de descuento global:
// venta.descuento guardado = 130, total = 870.
const venta = {
  id: "v1",
  numeroVenta: 7,
  clienteId: null,
  clienteNombre: "Ana",
  clienteTelefono: null,
  items: [
    {
      id: "it1",
      inventarioId: "i1",
      descripcion: "Mouse",
      cantidad: 1,
      precioUnitario: 1000,
      diasGarantia: 0,
      descuento: 100,
      tipoDescuento: "MONTO" as const,
      porcentajeDescuento: 0,
    },
  ],
  descuentoGlobal: { tipo: "MONTO" as const, valor: 30 },
  observaciones: null,
  montoAbonado: 870,
  cobroEnEfectivo: false,
}

describe("VentaEditForm", () => {
  beforeEach(() => {
    showError.mockClear()
    showSuccess.mockClear()
  })

  it("guarda sin cambios con el mismo total: el descuento de línea no se suma al global", async () => {
    const calls = stubFetch()
    const onSuccess = vi.fn()
    render(<VentaEditForm open onOpenChange={() => {}} venta={venta} onSuccess={onSuccess} />)

    // Antes el formulario tomaba venta.descuento (130) como global y volvía a
    // restar los 100 de la línea: mostraba y guardaba $770.
    expect((await screen.findByText("Total:")).parentElement).toHaveTextContent("$870")

    fireEvent.click(screen.getByRole("button", { name: /guardar cambios/i }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())

    const put = calls.find((c) => c.method === "PUT")!
    expect(put.url).toBe("/api/ventas/v1")
    expect(put.body).toMatchObject({
      action: "edit",
      descuento: 30,
      tipoDescuento: "MONTO",
      porcentajeDescuento: 0,
    })
    expect(put.body.items[0]).toMatchObject({ descuento: 100, tipoDescuento: "MONTO" })
    expect(put.body).not.toHaveProperty("metodoPago")
  })

  it("no deja guardar un total menor a lo ya cobrado", async () => {
    stubFetch()
    render(<VentaEditForm open onOpenChange={() => {}} venta={venta} onSuccess={() => {}} />)

    const precio = await screen.findByDisplayValue("1000")
    fireEvent.change(precio, { target: { value: "500" } })

    expect(await screen.findByText(/no puede quedar por debajo de lo ya cobrado/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /guardar cambios/i })).toBeDisabled()
  })

  it("busca clientes registrados (lee { data } de /api/clientes)", async () => {
    stubFetch()
    render(<VentaEditForm open onOpenChange={() => {}} venta={venta} onSuccess={() => {}} />)

    fireEvent.focus(await screen.findByLabelText(/nombre del cliente/i))
    expect(await screen.findByText("Carla")).toBeInTheDocument()
  })
})
