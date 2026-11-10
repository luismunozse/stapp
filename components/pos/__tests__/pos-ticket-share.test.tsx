// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { PosTicketShare } from "@/components/pos/pos-ticket-share"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}`, timezone: "America/Argentina/Buenos_Aires" }),
}))
vi.mock("html2canvas", () => ({ default: vi.fn() }))

const BASE = {
  id: "v1",
  numeroVenta: 3,
  clienteNombre: "Ana",
  items: [{ descripcion: "Cable", cantidad: 1, precioUnitario: 100 }],
  total: 100,
  metodoPago: "EFECTIVO",
}

function setup(clienteTelefono: string | null) {
  const buildManualWhatsAppUrl = vi.fn(() => "https://wa.me/test")
  render(
    <PosTicketShare
      ventaData={{ ...BASE, clienteTelefono }}
      countryCode="AR"
      buildManualWhatsAppUrl={buildManualWhatsAppUrl}
    />
  )
  fireEvent.click(screen.getByRole("button", { name: /enviar/i }))
  return { buildManualWhatsAppUrl }
}

describe("PosTicketShare — menú Enviar", () => {
  it("el control de descargar imagen tiene etiqueta de texto visible", () => {
    setup("1155550000")
    const boton = screen.getByRole("button", { name: /descargar imagen/i })
    expect(boton).toHaveTextContent(/descargar imagen/i)
  })

  it("con teléfono registrado ofrece WhatsApp y no pide teléfono", () => {
    setup("1155550000")
    expect(screen.getByRole("button", { name: /whatsapp/i })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/teléfono/i)).not.toBeInTheDocument()
  })

  it("sin teléfono registrado muestra el campo de teléfono y arma el enlace manual", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null)
    const { buildManualWhatsAppUrl } = setup(null)
    const input = screen.getByPlaceholderText(/teléfono/i)
    const wa = screen.getByRole("button", { name: /whatsapp/i })
    expect(wa).toBeDisabled()
    fireEvent.change(input, { target: { value: " 1122223333 " } })
    fireEvent.click(wa)
    expect(buildManualWhatsAppUrl).toHaveBeenCalledWith("1122223333")
    expect(open).toHaveBeenCalledWith("https://wa.me/test", "_blank")
    open.mockRestore()
  })
})
