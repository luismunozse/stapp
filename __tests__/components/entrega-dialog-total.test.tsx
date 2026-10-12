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

  it("pasa el pendiente devuelto por el servidor para encadenar el cobro", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({ estado: "ENTREGADO", pendienteCobro: 75000 }),
      } as Response)
    )
    const { onSuccess } = renderDialog()

    fireEvent.click(screen.getByRole("button", { name: /confirmar/i }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(75000))
  })

  it("anticipa que se va a abrir el cobro en vez de mandar a buscarlo", () => {
    renderDialog({ estadoCobro: "PENDIENTE", pendienteCobro: 75000 })

    expect(screen.getByText(/Al confirmar se abre la pantalla de cobro/i)).toBeInTheDocument()
    expect(screen.queryByText(/despu[eé]s de la entrega desde el detalle/i)).not.toBeInTheDocument()
  })

  // El servidor recalcula el total leyendo precio_venta_unitario/precio_unitario
  // de la base (entregar/route.ts), asi que si el dialogo suma de menos el
  // operador confirma un monto y al cliente se le cobra otro. Una fila anterior
  // a la migracion 286 leida por un rol sin acceso a inventario no tiene ningun
  // precio utilizable: el dialogo no puede publicar un total incompleto.
  describe("repuestos sin precio utilizable (rol gateado + fila pre-286)", () => {
    const repuestosGated = [
      {
        id: "r1",
        cantidad: 2,
        precioUnitario: null,
        precioVentaUnitario: 4500,
        inventario: { nombre: "Pantalla iPhone 12" },
      },
      {
        id: "r2",
        cantidad: 1,
        precioUnitario: null,
        precioVentaUnitario: null,
        nombre: "Flex de carga",
      },
    ]

    it("no publica un total de repuestos al que le falta un sumando", () => {
      renderDialog({ repuestos: repuestosGated })

      expect(screen.queryByText("Total repuestos")).not.toBeInTheDocument()
      expect(screen.getByText(/no se puede calcular el total de repuestos/i)).toBeInTheDocument()
      expect(screen.getAllByText(/Sin precio/).length).toBeGreaterThan(0)
      // 2 × 4500 es el subtotal de la fila con precio; lo que no puede salir es
      // ese mismo numero publicado como si fuera el total de repuestos.
      expect(screen.getAllByText(/9\.000/)).toHaveLength(1)
    })

    it("destildado, no muestra un 'Se cobrara' que no puede calcular", async () => {
      renderDialog({ repuestos: repuestosGated })

      fireEvent.change(screen.getByLabelText("Total a cobrar"), { target: { value: "50000" } })
      fireEvent.click(screen.getByRole("checkbox", { name: /ya incluye/i }))

      expect(await screen.findByText(/no se puede calcular el total ac[aá]/i)).toBeInTheDocument()
      expect(screen.queryByText("Se cobrará")).not.toBeInTheDocument()
      expect(screen.queryByText(/59\.000/)).not.toBeInTheDocument()
    })

    it("tildado el total es el que tipeo el operador, y ese si se muestra", () => {
      renderDialog({ repuestos: repuestosGated })

      fireEvent.change(screen.getByLabelText("Total a cobrar"), { target: { value: "50000" } })

      expect(screen.getByText("Se cobrará")).toBeInTheDocument()
      expect(screen.getByText(/50\.000/)).toBeInTheDocument()
    })

    it("con todos los precios de venta presentes sigue mostrando el total", () => {
      renderDialog({ repuestos: [repuestosGated[0]] })

      expect(screen.getByText("Total repuestos")).toBeInTheDocument()
      expect(screen.getAllByText(/9\.000/).length).toBeGreaterThan(0)
      expect(screen.queryByText(/no se puede calcular/i)).not.toBeInTheDocument()
    })
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
