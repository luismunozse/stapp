// __tests__/components/pos-product-search-venta-sucursal.test.tsx
//
// POS product search must always opt into scope=venta (so stock shown/added
// to cart matches the sucursal/deposito the sale will actually decrement),
// and must report the resolved sucursal (from response headers) to the
// parent exactly once via onVentaSucursal.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { PosProductSearch, type VentaSucursalInfo } from "@/components/pos/pos-product-search"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}` }),
}))

function okResponse(headers: Record<string, string> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => [],
    headers: new Headers(headers),
  }
}

function errorResponse(status = 500) {
  return {
    ok: false,
    status,
    // A 500 from the route still has a JSON body, so parsing succeeds and the
    // failure is only visible through `ok`.
    json: async () => ({ error: "Error al buscar productos" }),
    headers: new Headers(),
  }
}

function mockFetchOnce(headers: Record<string, string> = {}) {
  return vi.fn().mockResolvedValue(okResponse(headers))
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

  it("una respuesta con error NO reporta sucursal (un 500 tambien parsea como JSON)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse())
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

    // La carga inicial ya termino (el skeleton dio paso al empty state).
    await waitFor(() => expect(screen.getByText("Sin productos")).toBeInTheDocument())
    expect(onVentaSucursal).not.toHaveBeenCalled()
  })

  // La cookie de sucursal activa la comparten TODAS las pestañas, pero solo la
  // que hace el cambio recarga. Sin revalidar, esta pestaña sigue afirmando
  // "Vendiendo desde: <sucursal vieja>" mientras /api/ventas atribuye y
  // descuenta de la nueva — el caso de "desinformar al operador sobre de dónde
  // salió su inventario" que derivarLecturaVenta evita ocultando el indicador.
  describe("revalidacion al volver a la pestaña", () => {
    const CASA_CENTRAL = {
      "X-Venta-Sucursal-Id": "suc-A",
      "X-Venta-Sucursal-Nombre": encodeURIComponent("Casa Central"),
    }
    const NORTE = {
      "X-Venta-Sucursal-Id": "suc-B",
      "X-Venta-Sucursal-Nombre": encodeURIComponent("Sucursal Norte"),
    }

    function renderConIndicador(onVentaSucursal: (info: VentaSucursalInfo) => void) {
      return render(
        <PosProductSearch
          onAddProduct={() => {}}
          onAddManualProduct={() => {}}
          onOpenScanner={() => {}}
          scanSuccess={null}
          onVentaSucursal={onVentaSucursal}
        />
      )
    }

    it("VS-1 — al volver el foco, revalida y reporta la sucursal nueva", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(okResponse(CASA_CENTRAL))
        .mockResolvedValue(okResponse(NORTE))
      vi.stubGlobal("fetch", fetchMock)
      const onVentaSucursal = vi.fn()

      renderConIndicador(onVentaSucursal)
      await waitFor(() =>
        expect(onVentaSucursal).toHaveBeenCalledWith({ id: "suc-A", nombre: "Casa Central" })
      )

      fireEvent(window, new Event("focus"))

      await waitFor(() =>
        expect(onVentaSucursal).toHaveBeenLastCalledWith({ id: "suc-B", nombre: "Sucursal Norte" })
      )
    })

    it("VS-2 — foco y visibilitychange llegan juntos: revalida UNA sola vez", async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse(CASA_CENTRAL))
      vi.stubGlobal("fetch", fetchMock)

      renderConIndicador(vi.fn())
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

      fireEvent(window, new Event("focus"))
      document.dispatchEvent(new Event("visibilitychange"))

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
      // Un rato despues sigue siendo una sola: el segundo evento no paso.
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it("VS-3 — una revalidacion que falla NO borra el indicador ya resuelto", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(okResponse(CASA_CENTRAL))
        .mockResolvedValue(errorResponse())
      vi.stubGlobal("fetch", fetchMock)
      const onVentaSucursal = vi.fn()

      renderConIndicador(onVentaSucursal)
      await waitFor(() => expect(onVentaSucursal).toHaveBeenCalledTimes(1))

      fireEvent(window, new Event("focus"))

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
      await new Promise((resolve) => setTimeout(resolve, 50))
      // Un 500 parsea como JSON y no trae headers: reportarlo apagaria el
      // indicador que ya estaba bien resuelto.
      expect(onVentaSucursal).toHaveBeenCalledTimes(1)
    })
  })

  it("dos montajes (desktop + mobile): el que falla no pisa al que resolvio", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        okResponse({
          "X-Venta-Sucursal-Id": "suc-1",
          "X-Venta-Sucursal-Nombre": encodeURIComponent("Casa Central"),
        })
      )
      .mockResolvedValueOnce(errorResponse())
    vi.stubGlobal("fetch", fetchMock)
    const onVentaSucursal = vi.fn()

    const props = {
      onAddProduct: () => {},
      onAddManualProduct: () => {},
      onOpenScanner: () => {},
      scanSuccess: null,
      onVentaSucursal,
    }
    render(
      <>
        <PosProductSearch {...props} />
        <PosProductSearch {...props} />
      </>
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(onVentaSucursal).toHaveBeenCalledWith({ id: "suc-1", nombre: "Casa Central" })
    )
    expect(onVentaSucursal).toHaveBeenCalledTimes(1)
  })
})
