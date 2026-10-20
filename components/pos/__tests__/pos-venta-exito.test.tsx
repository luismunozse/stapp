// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, within, act } from "@testing-library/react"
import { PosVentaExito, textoGarantias } from "@/components/pos/pos-venta-exito"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}`, timezone: "America/Argentina/Buenos_Aires" }),
}))
vi.mock("html2canvas", () => ({ default: vi.fn() }))

const VENTA = {
  id: "v1",
  numeroVenta: 12,
  clienteNombre: "Ana Pérez",
  clienteTelefono: "1155550000",
  total: 1500,
  metodoPago: "EFECTIVO",
  items: [
    { descripcion: "Teclado", cantidad: 1, precioUnitario: 1000, subtotal: 1000 },
    { descripcion: "Mouse", cantidad: 2, precioUnitario: 250, subtotal: 500 },
  ],
  pagos: [{ metodoPago: "EFECTIVO", monto: 1500 }],
  garantias: [],
}

function setup(over: Record<string, any> = {}) {
  const props = {
    venta: VENTA,
    cobro: null,
    onClose: vi.fn(),
    onPrint: vi.fn(),
    printer: { connected: false, printing: false },
    facturacion: { disponible: false, emitiendo: false, comprobante: null, error: null, onEmitir: vi.fn() },
    plantillaCorta: undefined,
    countryCode: "AR",
    buildManualWhatsAppUrl: vi.fn(() => "https://wa.me/x"),
    ...over,
  }
  render(<PosVentaExito {...(props as any)} />)
  return props
}

describe("textoGarantias", () => {
  it("singular y plural sin '(s)'", () => {
    expect(textoGarantias(1)).toBe("1 certificado de garantía generado")
    expect(textoGarantias(3)).toBe("3 certificados de garantía generados")
  })
})

describe("PosVentaExito — héroe", () => {
  it("muestra el vuelto como héroe en efectivo con monto recibido", () => {
    setup({ cobro: { montoRecibido: 2000, vuelto: 500 } })
    const hero = screen.getByTestId("venta-exito-hero")
    expect(within(hero).getByText("Vuelto")).toBeInTheDocument()
    expect(within(hero).getByText("$500")).toBeInTheDocument()
    expect(within(hero).getByText(/Recibido \$2000/)).toBeInTheDocument()
  })

  it("sin cobro, el total es el héroe y no hay vuelto", () => {
    setup()
    const hero = screen.getByTestId("venta-exito-hero")
    expect(within(hero).getByText("Total")).toBeInTheDocument()
    expect(within(hero).getByText("$1500")).toBeInTheDocument()
    expect(screen.queryByText("Vuelto")).not.toBeInTheDocument()
  })
})

// El ticket oculto para html2canvas también contiene estos textos: se busca
// solo dentro del detalle visible.
const detalle = () => within(screen.getByRole("region", { name: "Detalle de la venta" }))

describe("PosVentaExito — comprobante", () => {
  it("muestra cliente, ítems y medio de pago", () => {
    setup()
    expect(detalle().getByText("Ana Pérez")).toBeInTheDocument()
    expect(detalle().getByText(/Teclado/)).toBeInTheDocument()
    expect(detalle().getByText("Efectivo")).toBeInTheDocument()
  })

  it("colapsa ítems largos con 'y N más' y los expande", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      descripcion: `Prod ${i + 1}`, cantidad: 1, precioUnitario: 10, subtotal: 10,
    }))
    setup({ venta: { ...VENTA, items } })
    expect(detalle().getByText(/Prod 3/)).toBeInTheDocument()
    expect(detalle().queryByText(/Prod 4/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /y 2 más/i }))
    expect(detalle().getByText(/Prod 5/)).toBeInTheDocument()
  })
})

describe("PosVentaExito — estados", () => {
  it("pluraliza los certificados de garantía", () => {
    setup({ venta: { ...VENTA, garantias: [{ numeroGarantia: 1, diasValidez: 30 }] } })
    expect(screen.getByText("1 certificado de garantía generado")).toBeInTheDocument()
  })

  it("avisa 'Ticket impreso automáticamente' con tilde cuando hay impresora", () => {
    setup({ printer: { connected: true, printing: false } })
    expect(screen.getByText("Ticket impreso automáticamente")).toBeInTheDocument()
  })

  it("muestra la factura emitida con el enlace 'Ver factura'", () => {
    setup({
      facturacion: {
        disponible: true, emitiendo: false, error: null, onEmitir: vi.fn(),
        comprobante: { tipo: "B", numero: 33, pdf_url: "https://x/f.pdf" },
      },
    })
    expect(screen.getByRole("link", { name: "Ver factura" })).toHaveAttribute("href", "https://x/f.pdf")
  })

  it("muestra el error de facturación", () => {
    setup({
      facturacion: {
        disponible: true, emitiendo: false, comprobante: null, onEmitir: vi.fn(),
        error: "CUIT inválido",
      },
    })
    expect(screen.getByText("CUIT inválido")).toBeInTheDocument()
  })
})

describe("PosVentaExito — acciones", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("Factura solo aparece si la facturación está disponible", () => {
    setup()
    expect(screen.queryByRole("button", { name: /factura/i })).not.toBeInTheDocument()
  })

  it("Factura dispara onEmitir", () => {
    const onEmitir = vi.fn()
    setup({ facturacion: { disponible: true, emitiendo: false, comprobante: null, error: null, onEmitir } })
    fireEvent.click(screen.getByRole("button", { name: /factura/i }))
    expect(onEmitir).toHaveBeenCalled()
  })

  it("Imprimir llama a onPrint", () => {
    const { onPrint } = setup()
    fireEvent.click(screen.getByRole("button", { name: /imprimir/i }))
    expect(onPrint).toHaveBeenCalled()
  })

  it("Nueva venta llama a onClose", () => {
    const { onClose } = setup()
    fireEvent.click(screen.getByRole("button", { name: /nueva venta/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("Enter cierra el overlay (Nueva venta) pasado el período de gracia", () => {
    const { onClose } = setup()
    act(() => { vi.advanceTimersByTime(600) })
    fireEvent.keyDown(document.body, { key: "Enter" })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("Enter dentro de un input no cierra el overlay", () => {
    const { onClose } = setup({ venta: { ...VENTA, clienteTelefono: null } })
    act(() => { vi.advanceTimersByTime(600) })
    fireEvent.click(screen.getByRole("button", { name: /enviar/i }))
    const input = screen.getByPlaceholderText(/teléfono/i)
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onClose).not.toHaveBeenCalled()
  })

  it("ignora Enter durante los primeros 500 ms (doble Enter del cobro / lector)", () => {
    const { onClose } = setup()
    act(() => { vi.advanceTimersByTime(300) })
    fireEvent.keyDown(document.body, { key: "Enter" })
    expect(onClose).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(300) })
    fireEvent.keyDown(document.body, { key: "Enter" })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("ignora Enter dentro de otro diálogo o de un popper de Radix", () => {
    const { onClose } = setup()
    act(() => { vi.advanceTimersByTime(600) })
    const otro = document.createElement("div")
    otro.setAttribute("role", "dialog")
    const hijo = document.createElement("span")
    otro.appendChild(hijo)
    document.body.appendChild(otro)
    fireEvent.keyDown(hijo, { key: "Enter" })
    const popper = document.createElement("div")
    popper.setAttribute("data-radix-popper-content-wrapper", "")
    const hijo2 = document.createElement("span")
    popper.appendChild(hijo2)
    document.body.appendChild(popper)
    fireEvent.keyDown(hijo2, { key: "Enter" })
    expect(onClose).not.toHaveBeenCalled()
    otro.remove()
    popper.remove()
  })
})

describe("PosVentaExito — pagos y saldo", () => {
  it("venta fiada sin pagos: no inventa un pago por el total", () => {
    setup({ venta: { ...VENTA, pagos: [], metodoPago: "CUENTA_CORRIENTE", saldoPendiente: 1500 } })
    expect(detalle().queryByText("Cta. Cte.")).not.toBeInTheDocument()
    expect(detalle().getByText("Saldo pendiente")).toBeInTheDocument()
  })

  it("sin pagos y sin saldo pendiente cae al método de la cabecera", () => {
    setup({ venta: { ...VENTA, pagos: [], saldoPendiente: 0 } })
    expect(detalle().getByText("Efectivo")).toBeInTheDocument()
  })

  it("muestra una línea de subtotal cuando el total no es la suma de los ítems", () => {
    setup({ venta: { ...VENTA, subtotal: 1500, total: 1650 } })
    expect(detalle().getByText("Subtotal")).toBeInTheDocument()
  })
})
