import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"
import { CotizacionForm } from "@/components/cotizaciones/cotizacion-form"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}`, pais: "AR" }),
  useTerminologia: () => (key: string) => key,
}))

const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
  Promise.resolve({ ok: true, json: async () => ({}) } as Response)
)

const renderForm = (aceptada: boolean) =>
  render(
    <ModalProvider>
      <CotizacionForm
        ordenId="orden-1"
        aceptada={aceptada}
        initialData={{
          id: "cot-1",
          // Vencimiento ya pasado: en una aceptada no tiene que frenar el guardado.
          fechaVencimiento: "2020-01-01T12:00:00Z",
          items: [{ id: "it-1", descripcion: "Pantalla", cantidad: 1, precioUnitario: 100, subtotal: 100 } as any],
        }}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    </ModalProvider>
  )

const putCalls = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT")
const guardar = () => fireEvent.click(screen.getByRole("button", { name: /Actualizar/ }))

describe("CotizacionForm — editar una cotización aceptada", () => {
  beforeEach(() => {
    fetchMock.mockClear()
    vi.stubGlobal("fetch", fetchMock)
  })

  it("una cotización no aceptada no muestra la elección", () => {
    renderForm(false)
    expect(screen.queryByText(/ya fue aceptada por el cliente/i)).not.toBeInTheDocument()
  })

  it("no guarda una aceptada sin elegir si sigue aceptada o pide firma", async () => {
    renderForm(true)
    guardar()

    expect(await screen.findByText(/firmarla de nuevo/i)).toBeInTheDocument()
    expect(putCalls()).toHaveLength(0)
  })

  it("manda el modo elegido en el PUT", async () => {
    renderForm(true)
    fireEvent.click(screen.getByLabelText(/Pedir la firma de nuevo/))
    guardar()

    await waitFor(() => expect(putCalls()).toHaveLength(1))
    const body = JSON.parse(String(putCalls()[0][1]!.body))
    expect(body.modoAceptada).toBe("PEDIR_FIRMA")
  })
})
