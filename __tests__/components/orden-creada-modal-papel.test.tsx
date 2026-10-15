/**
 * "Orden creada" modal: the same per-print paper size as the order screen. This is the moment a
 * workshop prints the reception sheet, so the selector has to be here too.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { OrdenCreadaModal } from "@/components/ordenes/orden-creada-modal"

let orgDefault = "A4"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({
    formatPrice: (n: number) => `$${n}`,
    formatDate: () => "11/10/2026",
    timezone: "America/Argentina/Buenos_Aires",
    pais: "AR",
    ordenFormatoPapel: orgDefault,
  }),
}))
vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ showError: vi.fn(), confirm: vi.fn(), alert: vi.fn() }),
}))
vi.mock("@/components/ordenes/print-label", () => ({ printDeviceLabel: vi.fn() }))
vi.mock("@/components/ordenes/thermal-print-orden", () => ({ ThermalPrintOrden: () => <div /> }))
vi.mock("@/components/icons/whatsapp-icon", () => ({ WhatsAppIcon: () => <span /> }))

const ORDEN = {
  id: "ord-9",
  numeroOrden: 9,
  codigoOrden: "CEL0009",
  dispositivo: "iPhone 13",
  problemaReportado: "No enciende",
  publicToken: "tok-9",
  cliente: { nombre: "Ana Pérez", telefono: "1122334455" },
}

const fetchMock = vi.fn()
const pdfRequests = () => fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/pdf"))

function renderModal() {
  render(<OrdenCreadaModal open onClose={() => {}} orden={ORDEN} />)
  return screen.getByRole("combobox", { name: /Tamaño de hoja para imprimir/i }) as HTMLSelectElement
}

beforeEach(() => {
  vi.clearAllMocks()
  orgDefault = "A4"
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/pdf")) return { ok: true, status: 200, blob: async () => new Blob(["pdf"]) }
    return { ok: true, status: 200, json: async () => null }
  })
  vi.stubGlobal("fetch", fetchMock)
  vi.stubGlobal("open", vi.fn(() => ({ addEventListener: vi.fn() })))
  window.URL.createObjectURL = vi.fn(() => "blob:test")
})

describe("OrdenCreadaModal: paper size of this print", () => {
  it("shows the selector on the workshop's size, marked as theirs", () => {
    orgDefault = "A6"
    const select = renderModal()
    expect(select.tagName).toBe("SELECT")
    expect(select.value).toBe("A6")
    expect(Array.from(select.options).map((o) => o.textContent)).toContain("A6 (un cuarto de hoja) · la del taller")
  })

  it("Imprimir without choosing asks for no size", async () => {
    orgDefault = "A5"
    renderModal()
    fireEvent.click(screen.getByRole("button", { name: /Imprimir/ }))
    await waitFor(() => expect(pdfRequests()).toEqual(["/api/ordenes/ord-9/pdf"]))
  })

  it("Imprimir after choosing A6 asks for A6", async () => {
    const select = renderModal()
    fireEvent.change(select, { target: { value: "A6" } })
    fireEvent.click(screen.getByRole("button", { name: /Imprimir/ }))
    await waitFor(() => expect(pdfRequests()).toEqual(["/api/ordenes/ord-9/pdf?papel=A6"]))
  })

  it("PDF after choosing A4 asks for A4", async () => {
    orgDefault = "A6"
    const select = renderModal()
    fireEvent.change(select, { target: { value: "A4" } })
    fireEvent.click(screen.getByRole("button", { name: /^PDF$/ }))
    await waitFor(() => expect(pdfRequests()).toEqual(["/api/ordenes/ord-9/pdf?papel=A4"]))
  })
})
