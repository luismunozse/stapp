// __tests__/components/barcode-scanner-scope-venta.test.tsx
//
// BarcodeScanner is shared between POS (needs scope=venta so stock reflects
// the sale's write-target deposito) and non-POS contexts (inventario list,
// conteos) which must keep today's behavior untouched. scopeVenta is an
// explicit opt-in prop, default off.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { BarcodeScanner } from "@/components/inventario/barcode-scanner"

function mockFetchOk() {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ found: false, code: "ABC" }),
  })
}

describe("BarcodeScanner — scopeVenta", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("scopeVenta=true agrega &scope=venta a la busqueda manual", async () => {
    const fetchMock = mockFetchOk()
    vi.stubGlobal("fetch", fetchMock)

    render(<BarcodeScanner open onOpenChange={() => {}} onResult={() => {}} scopeVenta />)

    fireEvent.change(screen.getByPlaceholderText("Código de barras..."), { target: { value: "ABC123" } })
    fireEvent.click(screen.getByRole("button", { name: "" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain("scope=venta")
  })

  it("sin scopeVenta (default, uso no-POS): NO agrega scope=venta", async () => {
    const fetchMock = mockFetchOk()
    vi.stubGlobal("fetch", fetchMock)

    render(<BarcodeScanner open onOpenChange={() => {}} onResult={() => {}} />)

    fireEvent.change(screen.getByPlaceholderText("Código de barras..."), { target: { value: "ABC123" } })
    fireEvent.click(screen.getByRole("button", { name: "" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).not.toContain("scope=venta")
  })
})
