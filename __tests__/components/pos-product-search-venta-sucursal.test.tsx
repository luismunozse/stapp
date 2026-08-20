// __tests__/components/pos-product-search-venta-sucursal.test.tsx
//
// POS product search must always opt into scope=venta (so stock shown/added
// to cart matches the sucursal/deposito the sale will actually decrement),
// and must report the resolved sucursal (from response headers) to the
// parent exactly once via onVentaSucursal.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { PosProductSearch } from "@/components/pos/pos-product-search"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}` }),
}))

function mockFetchOnce(headers: Record<string, string> = {}) {
  return vi.fn().mockResolvedValue({
    json: async () => [],
    headers: new Headers(headers),
  })
}

describe("PosProductSearch — scope=venta", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("la carga inicial pide scope=venta", async () => {
    const fetchMock = mockFetchOnce()
    vi.stubGlobal("fetch", fetchMock)

    render(
      <PosProductSearch onAddProduct={() => {}} onAddManualProduct={() => {}} onOpenScanner={() => {}} scanSuccess={null} />
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain("scope=venta")
    // Only the mount fetch consumes the X-Venta-Sucursal-* headers, so only it
    // asks the server to resolve the (extra-query) sucursal name.
    expect(url).toContain("ventaInfo=true")
  })

  it("la búsqueda debounced NO pide ventaInfo (una query de nombre por tecla)", async () => {
    const fetchMock = mockFetchOnce()
    vi.stubGlobal("fetch", fetchMock)

    render(
      <PosProductSearch onAddProduct={() => {}} onAddManualProduct={() => {}} onOpenScanner={() => {}} scanSuccess={null} />
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByPlaceholderText(/Buscar producto/i), {
      target: { value: "cable" },
    })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const searchUrl = fetchMock.mock.calls[1][0] as string
    expect(searchUrl).toContain("scope=venta")
    expect(searchUrl).not.toContain("ventaInfo")
  })

  it("reporta la sucursal resuelta via onVentaSucursal, decodificando el nombre", async () => {
    const fetchMock = mockFetchOnce({
      "X-Venta-Sucursal-Id": "suc-1",
      "X-Venta-Sucursal-Nombre": encodeURIComponent("Sucursal Ñuñoa"),
    })
    vi.stubGlobal("fetch", fetchMock)
    const onVentaSucursal = vi.fn()

    render(
      <PosProductSearch
        onAddProduct={() => {}}
        onAddManualProduct={() => {}}
        onOpenScanner={() => {}}
        scanSuccess={null}
        onVentaSucursal={onVentaSucursal}
      />
    )

    await waitFor(() =>
      expect(onVentaSucursal).toHaveBeenCalledWith({ id: "suc-1", nombre: "Sucursal Ñuñoa" })
    )
  })

  it("sin headers de sucursal (endpoint no-scope-venta legado): reporta null sin explotar", async () => {
    const fetchMock = mockFetchOnce()
    vi.stubGlobal("fetch", fetchMock)
    const onVentaSucursal = vi.fn()

    render(
      <PosProductSearch
        onAddProduct={() => {}}
        onAddManualProduct={() => {}}
        onOpenScanner={() => {}}
        scanSuccess={null}
        onVentaSucursal={onVentaSucursal}
      />
    )

    await waitFor(() => expect(onVentaSucursal).toHaveBeenCalledWith({ id: null, nombre: null }))
  })
})
