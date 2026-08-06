import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { PrinterCalibrationWizard } from "@/components/impresora/printer-calibration-wizard"
import { readProfile } from "@/lib/thermal-paper"

const printMock = vi.fn().mockResolvedValue(true)
vi.mock("@/components/pos/use-thermal-printer", () => ({
  useThermalPrinter: () => ({
    connected: true, connecting: false, device: { name: "Test", vendorId: 1, productId: 1 },
    error: null, isSupported: true,
    connect: vi.fn(), disconnect: vi.fn(), print: printMock,
  }),
}))

describe("PrinterCalibrationWizard", () => {
  beforeEach(() => {
    localStorage.clear()
    printMock.mockClear()
  })

  it("con impresora conectada arranca en el paso de columnas e imprime el test al pedirlo", async () => {
    render(<PrinterCalibrationWizard open onOpenChange={() => {}} />)
    expect(screen.getByText(/test de columnas/i)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /imprimir test/i }))
    await vi.waitFor(() => expect(printMock).toHaveBeenCalledTimes(1))
  })

  it("responder columnas persiste el perfil y avanza a acentos", () => {
    render(<PrinterCalibrationWizard open onOpenChange={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /^2\)/ })) // "2) 42 columnas"
    expect(readProfile()).toMatchObject({ columnas: 42, ancho: 80 })
    expect(screen.getByText(/test de acentos/i)).toBeTruthy()
  })

  it("el flujo completo persiste codepage y corte", () => {
    render(<PrinterCalibrationWizard open onOpenChange={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /^3\)/ })) // 48 col
    fireEvent.click(screen.getByRole("button", { name: /^4\)/ })) // win1252
    fireEvent.click(screen.getByRole("button", { name: /no corta/i }))
    expect(readProfile()).toMatchObject({ columnas: 48, codepage: "win1252", corte: "none" })
    expect(screen.getByText(/ticket de prueba/i)).toBeTruthy()
  })
})
