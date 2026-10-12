import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { SWRConfig } from "swr"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({
    formatPrice: (n: number) => `$${n}`,
    formatDate: (d: string) => d,
  }),
}))

vi.mock("@/components/ui/page-shell", () => ({
  PageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock("@/components/inventario/kit-dialog", () => ({
  KitDialog: () => null,
}))

import KitsPage from "@/app/(dashboard)/inventario/kits/page"

/**
 * /api/inventario/kits devuelve costoCalculado y precioCompra en null para los
 * roles sin acceso a costos de compra. La página los tipaba como number, así
 * que no hubo señal de compilación: en runtime formatPrice(null) devuelve "" y
 * cada card quedaba con el label "Costo receta" y el valor en blanco.
 */
describe("KitsPage — costo de receta nulo", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function stubFetch(costoCalculado: number | null, precioCompra: number | null) {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              {
                id: "kit-1",
                codigo: "K1",
                nombre: "Kit reparacion",
                stock: 3,
                stockReservado: 0,
                precioCompra,
                precioVenta: 5000,
                tipoKit: "ENSAMBLADO",
                imagenUrl: null,
                categoria: "Kits",
                tipoDispositivo: "Kit",
                cantidadComponentes: 4,
                costoCalculado,
              },
            ],
            total: 1,
          }),
        } as Response),
      ),
    )
  }

  function renderPage() {
    return render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <KitsPage />
      </SWRConfig>,
    )
  }

  it("oculta el costo de receta cuando viene en null", async () => {
    stubFetch(null, null)

    renderPage()
    await waitFor(() => expect(screen.getByText("Kit reparacion")).toBeInTheDocument())

    expect(screen.queryByText("Costo receta")).not.toBeInTheDocument()
    expect(screen.queryByText("$0")).not.toBeInTheDocument()
    // Lo que no es costo sigue disponible.
    expect(screen.getByText("Componentes")).toBeInTheDocument()
    expect(screen.getByText("4")).toBeInTheDocument()
  })

  it("muestra el costo de receta cuando el rol puede verlo", async () => {
    stubFetch(1200, 900)

    renderPage()
    await waitFor(() => expect(screen.getByText("Kit reparacion")).toBeInTheDocument())

    expect(screen.getByText("Costo receta")).toBeInTheDocument()
    expect(screen.getByText("$1200")).toBeInTheDocument()
  })
})
