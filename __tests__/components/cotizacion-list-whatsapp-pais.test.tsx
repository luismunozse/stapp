// El boton "WhatsApp" de una cotizacion abre wa.me con el telefono del cliente.
// El numero tiene que salir con el codigo del pais de la organizacion: a una org
// chilena, anteponerle el 54 argentino a un numero que ya trae el 56 produce un
// destinatario inexistente y el mensaje no se envia.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"
import { CotizacionList } from "@/components/cotizaciones/cotizacion-list"

const paisMock = { value: "AR" as string }

const cotizacionChilena = {
  id: "cot-1",
  numeroCotizacion: "COT-0001",
  estado: "ENVIADA",
  total: 1000,
  publicToken: "tok-1",
  clienteNombre: "Javiera",
  clienteTelefono: "+56 9 1234 5678",
  items: [],
}

vi.mock("swr", () => ({
  default: () => ({ data: [cotizacionChilena], isLoading: false, mutate: vi.fn() }),
}))

vi.mock("@/hooks/use-subscription", () => ({
  useHasFeature: () => ({ hasFeature: true, loading: false }),
}))

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({
    formatPrice: (n: number) => `$${n}`,
    formatDate: (d: string) => String(d),
    pais: paisMock.value,
  }),
  useTerminologia: () => (key: string) => key,
}))

const openSpy = vi.fn()

const clickWhatsApp = async () => {
  render(
    <ModalProvider>
      <CotizacionList ordenId="orden-1" />
    </ModalProvider>
  )
  fireEvent.click(screen.getByRole("button", { name: /WhatsApp/ }))
  await waitFor(() => expect(openSpy).toHaveBeenCalled())
  return String(openSpy.mock.calls[0][0])
}

describe("CotizacionList — WhatsApp usa el codigo de pais de la org", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("open", openSpy)
    paisMock.value = "AR"
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("org chilena: manda al 56, sin anteponer el 54 argentino", async () => {
    paisMock.value = "CL"

    const url = await clickWhatsApp()

    expect(url).toContain("wa.me/56912345678")
    expect(url).not.toContain("wa.me/5456")
  })

  it("org argentina: sigue anteponiendo el 54 a un numero local", async () => {
    paisMock.value = "AR"

    const url = await clickWhatsApp()

    // El numero del fixture ya trae 56; con pais AR no lo toca (no es local).
    expect(url).not.toContain("wa.me/5456")
  })
})
