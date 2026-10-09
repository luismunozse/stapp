/**
 * Comprobantes termicos de ingreso: "Trabajo a realizar" y la linea
 * "Garantia: N dias desde la entrega". Orden individual (ThermalPrintOrden) y
 * lote de recepcion multiple (ThermalPrintRecepcion). Ambos se omiten cuando
 * no hay dato.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

vi.mock("@/components/pos/use-thermal-printer", () => ({
  useThermalPrinter: () => ({
    connected: false,
    connecting: false,
    isSupported: false,
    connect: vi.fn(),
    print: vi.fn(),
  }),
}))
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,AAAA") },
}))

import { ThermalPrintOrden } from "@/components/ordenes/thermal-print-orden"
import { ThermalPrintRecepcion, type RecepcionReceiptData } from "@/components/ordenes/thermal-print-recepcion"

function ordenBase(extra: Record<string, unknown> = {}): any {
  return {
    id: "o1",
    numeroOrden: 7,
    codigoOrden: "CEL007",
    fechaIngreso: "2026-01-01T10:00:00.000Z",
    estado: "RECIBIDO",
    cliente: { nombre: "Juan Perez", telefono: "1122334455" },
    dispositivo: "iPhone 13",
    tipoDispositivo: "CELULAR",
    problemaReportado: "No enciende",
    organizationName: "Taller Test",
    organizationComprobanteTerminos: "El equipo no retirado en 90 dias se considera abandonado.",
    ...extra,
  }
}

function abrir(nombre: RegExp = /comprobante/i) {
  fireEvent.click(screen.getByRole("button", { name: nombre }))
}

describe("ThermalPrintOrden - trabajo a realizar y garantia", () => {
  beforeEach(() => localStorage.clear())

  it("muestra ambos bloques", () => {
    render(<ThermalPrintOrden orden={ordenBase({ trabajoARealizar: "Cambio de pantalla", organizationGarantiaDiasDefault: 30 })} />)
    abrir(/térmica/i)
    expect(screen.getByText("TRABAJO A REALIZAR")).toBeInTheDocument()
    expect(screen.getByText("Cambio de pantalla")).toBeInTheDocument()
    expect(screen.getByText("Garantía: 30 días desde la entrega")).toBeInTheDocument()
  })

  it("singular para 1 dia", () => {
    render(<ThermalPrintOrden orden={ordenBase({ organizationGarantiaDiasDefault: 1 })} />)
    abrir(/térmica/i)
    expect(screen.getByText("Garantía: 1 día desde la entrega")).toBeInTheDocument()
  })

  it("omite ambos cuando estan vacios (0, null, espacios)", () => {
    render(<ThermalPrintOrden orden={ordenBase({ trabajoARealizar: "   ", organizationGarantiaDiasDefault: 0 })} />)
    abrir(/térmica/i)
    expect(screen.queryByText("TRABAJO A REALIZAR")).toBeNull()
    expect(screen.queryByText(/Garantía:/)).toBeNull()
  })

  it("omite ambos cuando el dato falta por completo", () => {
    render(<ThermalPrintOrden orden={ordenBase()} />)
    abrir(/térmica/i)
    expect(screen.queryByText("TRABAJO A REALIZAR")).toBeNull()
    expect(screen.queryByText(/Garantía:/)).toBeNull()
  })
})

const recepcionBase: RecepcionReceiptData = {
  codigo: "REC-0007",
  fecha: "01/01/2026 10:00",
  clienteNombre: "Juan Perez",
  organizationName: "Taller Test",
  organizationComprobanteTerminos: "Terminos del taller.",
  equipos: [
    { codigoOrden: "A-001", dispositivo: "Galaxy S21", problemaReportado: "No enciende", trabajoARealizar: "Cambio de pantalla" },
    { codigoOrden: "A-002", dispositivo: "iPhone 12", problemaReportado: "Sin carga" },
  ],
}

describe("ThermalPrintRecepcion - trabajo a realizar y garantia", () => {
  beforeEach(() => localStorage.clear())

  it("muestra el trabajo solo en el equipo que lo tiene y la garantia una sola vez", () => {
    render(<ThermalPrintRecepcion data={{ ...recepcionBase, organizationGarantiaDiasDefault: 30 }} />)
    abrir()
    expect(screen.getAllByText(/Trabajo a realizar:/)).toHaveLength(1)
    expect(screen.getByText(/Cambio de pantalla/)).toBeInTheDocument()
    expect(screen.getAllByText("Garantía: 30 días desde la entrega")).toHaveLength(1)
  })

  it("omite la garantia con 0 o sin dato", () => {
    const { unmount } = render(<ThermalPrintRecepcion data={{ ...recepcionBase, organizationGarantiaDiasDefault: 0 }} />)
    abrir()
    expect(screen.queryByText(/Garantía:/)).toBeNull()
    unmount()
    render(<ThermalPrintRecepcion data={recepcionBase} />)
    abrir()
    expect(screen.queryByText(/Garantía:/)).toBeNull()
  })

  it("omite el trabajo cuando ningun equipo lo trae", () => {
    const equipos = recepcionBase.equipos.map((e) => ({ ...e, trabajoARealizar: "" }))
    render(<ThermalPrintRecepcion data={{ ...recepcionBase, equipos }} />)
    abrir()
    expect(screen.queryByText(/Trabajo a realizar/)).toBeNull()
  })
})
