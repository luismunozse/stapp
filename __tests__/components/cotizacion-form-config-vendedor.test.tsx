import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"
import { CotizacionForm } from "@/components/cotizaciones/cotizacion-form"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}`, pais: "AR" }),
  useTerminologia: () => (key: string) => key,
}))

// Lo que ve un VENDEDOR: /api/configuracion es solo ADMIN y responde 403;
// /api/configuracion/operativa la puede leer cualquier rol de la org. Antes el
// formulario usaba la primera y la cotización de un vendedor arrancaba con IVA
// 0, sin términos ni vencimiento.
function stubFetchVendedor() {
  const fetchMock = vi.fn((url: string) => {
    const href = String(url)
    if (href.startsWith("/api/configuracion/operativa")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          ivaPorcentaje: 21,
          cotizacionTerminos: "Precios sujetos a stock",
          cotizacionValidezDias: 15,
        }),
      } as Response)
    }
    if (href.startsWith("/api/configuracion")) {
      return Promise.resolve({ ok: false, status: 403, json: async () => ({ error: "No autorizado" }) } as Response)
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response)
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

describe("CotizacionForm — un vendedor recibe los valores por defecto de la org", () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it("arranca con el IVA y los términos de la org", async () => {
    const fetchMock = stubFetchVendedor()

    render(
      <ModalProvider>
        <CotizacionForm ordenId="orden-1" onClose={vi.fn()} onSuccess={vi.fn()} />
      </ModalProvider>
    )

    await waitFor(() => {
      expect(screen.getByLabelText("IVA")).toHaveTextContent("21%")
    })

    fireEvent.click(screen.getByRole("button", { name: /Detalles y notas/ }))
    expect(screen.getByLabelText("Términos y Condiciones")).toHaveValue("Precios sujetos a stock")
    expect(fetchMock.mock.calls.some(([u]) => String(u) === "/api/configuracion")).toBe(false)
  })
})
