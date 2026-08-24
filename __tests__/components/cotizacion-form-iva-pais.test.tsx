import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"
import { CotizacionForm } from "@/components/cotizaciones/cotizacion-form"

// El pais de la org viaja por el currency context. La superficie mockeada
// tiene que seguir a la que consume el componente (formatPrice + terminologia),
// mas el pais que ahora decide las alicuotas de IVA disponibles.
const paisMock = { value: "AR" as string }

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}`, pais: paisMock.value }),
  useTerminologia: () => (key: string) => key,
}))

const stubConfigFetch = (ivaPorcentaje: number) => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () => (String(url).includes("/api/configuracion") ? { ivaPorcentaje } : {}),
      } as Response)
    )
  )
}

const renderForm = () =>
  render(
    <ModalProvider>
      <CotizacionForm ordenId="orden-1" onClose={vi.fn()} onSuccess={vi.fn()} />
    </ModalProvider>
  )

describe("CotizacionForm — alicuotas de IVA segun el pais de la org", () => {
  beforeEach(() => {
    paisMock.value = "AR"
  })

  it("muestra la tasa chilena (19%) cuando la org es de Chile", async () => {
    paisMock.value = "CL"
    stubConfigFetch(19)

    renderForm()

    await waitFor(() => {
      expect(screen.getByLabelText("IVA")).toHaveTextContent("19%")
    })
  })

  it("sigue mostrando la tasa argentina (21%) cuando la org es de Argentina", async () => {
    paisMock.value = "AR"
    stubConfigFetch(21)

    renderForm()

    await waitFor(() => {
      expect(screen.getByLabelText("IVA")).toHaveTextContent("21%")
    })
  })
})
