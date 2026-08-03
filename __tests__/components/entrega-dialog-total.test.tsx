// __tests__/components/entrega-dialog-total.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { EntregaDialog } from "@/components/ordenes/entrega-dialog"

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null }) }))
vi.mock("sonner", () => ({ toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() } }))
// react-signature-canvas necesita un canvas real; jsdom no lo implementa y el
// componente explota al montar. La firma no es lo que se prueba acá.
vi.mock("@/components/firma/signature-pad", () => ({
  SignaturePad: () => null,
}))

const repuestos = [
  {
    id: "r1",
    cantidad: 2,
    precioUnitario: 1000,
    precioVentaUnitario: 4500,
    inventario: { nombre: "Pantalla iPhone 12" },
  },
  {
    id: "r2",
    cantidad: 1,
    precioUnitario: 500,
    precioVentaUnitario: 1200,
    nombre: "Flex de carga",
  },
]

const ordenBase = {
  id: "o1",
  numeroOrden: 7,
  dispositivo: "iPhone 12",
  estado: "REPARADO",
  cliente: { nombre: "Juan", telefono: "123" },
  costoFinal: null,
  repuestos,
}

function renderDialog(over: Record<string, unknown> = {}) {
  const onSuccess = vi.fn()
  render(
    <EntregaDialog
      open
      onClose={vi.fn()}
      onSuccess={onSuccess}
      orden={{ ...ordenBase, ...over } as any}
      encargadoNombre="Encargado"
    />
  )
  return { onSuccess }
}

/** Body del POST a /entregar. */
function entregarBody(mockFetch: ReturnType<typeof vi.fn>) {
  const call = mockFetch.mock.calls.find(([url]) =>
    typeof url === "string" && url.includes("/entregar")
  )
  return call ? JSON.parse((call[1] as RequestInit).body as string) : null
}

describe("EntregaDialog — resumen de repuestos y total a cobrar", () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => ({ estado: "ENTREGADO" }) } as Response)
    )
    vi.stubGlobal("fetch", mockFetch)
  })

  it("muestra el resumen de repuestos a precio de venta, no al costo", () => {
    renderDialog()

    expect(screen.getByText("Pantalla iPhone 12", { exact: false })).toBeInTheDocument()
    expect(screen.getByText("Total repuestos")).toBeInTheDocument()
    // 2 × 4500 + 1 × 1200 = 10200. Al costo habria dado 2500.
    expect(screen.getByText(/10\.200/)).toBeInTheDocument()
  })

  it("con el checkbox tildado manda el total tal cual", async () => {
    renderDialog()

    fireEvent.change(screen.getByLabelText("Total a cobrar"), { target: { value: "150000" } })
    fireEvent.click(screen.getByRole("button", { name: /confirmar/i }))

    await waitFor(() => {
      expect(entregarBody(mockFetch)).toMatchObject({
        totalACobrar: 150000,
        incluyeRepuestos: true,
      })
    })
  })

  it("destildado, avisa cuanto se va a cobrar sumando los repuestos", async () => {
    renderDialog()

    fireEvent.change(screen.getByLabelText("Total a cobrar"), { target: { value: "50000" } })
    fireEvent.click(screen.getByRole("checkbox", { name: /ya incluye/i }))

    // Preview en vivo: 50000 + 10200
    expect(await screen.findByText(/60\.200/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /confirmar/i }))

    await waitFor(() => {
      expect(entregarBody(mockFetch)).toMatchObject({
        totalACobrar: 50000,
        incluyeRepuestos: false,
      })
    })
  })

  it("si no se toca el total, no manda nada y la orden conserva su costo", async () => {
    renderDialog()

    fireEvent.click(screen.getByRole("button", { name: /confirmar/i }))

    await waitFor(() => {
      const body = entregarBody(mockFetch)
      expect(body).not.toBeNull()
      expect(body.totalACobrar).toBeUndefined()
      expect(body.incluyeRepuestos).toBeUndefined()
    })
  })

  it("arranca tildado: quien no toca nada obtiene el comportamiento previo", () => {
    renderDialog()
    expect(screen.getByRole("checkbox", { name: /ya incluye/i })).toBeChecked()
  })

  it("no muestra el bloque de cobro en una entrega sin cobro", () => {
    render(
      <EntregaDialog
        open
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        orden={ordenBase as any}
        encargadoNombre="Encargado"
        sinCobro
      />
    )
    expect(screen.queryByLabelText("Total a cobrar")).not.toBeInTheDocument()
  })
})
