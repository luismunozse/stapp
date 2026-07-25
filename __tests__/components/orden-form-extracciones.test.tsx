// __tests__/components/orden-form-extracciones.test.tsx
//
// AccesoriosPicker y FotosIngreso viven detras de currentStep === 2 y === 3
// respectivamente. Ningun otro test monta OrdenForm mas alla del paso 1, asi
// que ninguno los renderiza. Este test avanza el wizard hasta ambos pasos y
// verifica que sus controles reales esten en pantalla.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null }),
}))

vi.mock("@/hooks/use-tipos-dispositivo", () => ({
  useTiposDispositivo: () => ({
    tipos: [
      {
        codigo: "CELULAR",
        nombre: "Celular",
        config: {
          campos: {
            imei: { visible: true },
            password: { visible: true },
            color: { visible: true },
            marca: { visible: true },
          },
          accesorios: [{ id: "cargador", label: "Cargador" }],
          problemasComunes: ["No enciende"],
          marcas: ["Apple", "Samsung"],
          camposExtra: [],
        },
      },
    ],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

// Stub del selector de cliente: lo que se testea aca es que OrdenForm avance
// de paso y renderice los componentes extraidos, no el buscador de clientes
// (que tiene su propia logica de busqueda/debounce ya cubierta aparte).
vi.mock("@/components/cotizaciones/cliente-selector", () => ({
  ClienteSelector: ({
    onChange,
  }: {
    onChange: (id: string | null, cliente: { id: string; nombre: string } | null) => void
  }) => (
    <button
      type="button"
      onClick={() => onChange("cliente-test-1", { id: "cliente-test-1", nombre: "Cliente de Prueba" })}
    >
      Elegir cliente de prueba
    </button>
  ),
}))

describe("OrdenForm — componentes extraidos se renderizan al avanzar el wizard", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: async () => [] } as Response)),
    )
  })

  it(
    "avanza a los pasos 2 y 3 y muestra los controles de AccesoriosPicker y FotosIngreso",
    async () => {
      const { OrdenForm } = await import("@/components/ordenes/orden-form")
      render(
        <ModalProvider>
          <OrdenForm onClose={vi.fn()} onSuccess={vi.fn()} />
        </ModalProvider>,
      )

      // Completar lo minimo que pide el paso 1 para poder avanzar.
      fireEvent.click(screen.getByRole("button", { name: "Elegir cliente de prueba" }))
      fireEvent.click(screen.getByRole("button", { name: "Celular" }))
      fireEvent.change(screen.getByPlaceholderText("Modelo o descripcion del equipo"), {
        target: { value: "Notebook X" },
      })
      fireEvent.change(screen.getByPlaceholderText("Describa el problema del equipo..."), {
        target: { value: "No prende" },
      })

      fireEvent.click(screen.getByRole("button", { name: "Siguiente" }))

      // Paso 2: AccesoriosPicker.
      expect(await screen.findByText("Accesorios Recibidos")).toBeInTheDocument()
      expect(screen.getByText("Cargador")).toBeInTheDocument()
      const otroAccesorioInput = screen.getByPlaceholderText("Otro accesorio...")
      expect(otroAccesorioInput).toBeInTheDocument()
      // El boton de "agregar" es solo-icono (sin texto accesible); se
      // verifica que exista un boton junto al input, ya que es un control
      // visible aunque no tenga nombre accesible.
      const otroAccesorioRow = otroAccesorioInput.closest("div") as HTMLElement
      expect(within(otroAccesorioRow).getByRole("button")).toBeInTheDocument()

      fireEvent.click(screen.getByRole("button", { name: "Siguiente" }))

      // Paso 3: FotosIngreso.
      expect(await screen.findByRole("button", { name: "Seleccionar archivos" })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Tomar foto" })).toBeInTheDocument()
      expect(
        screen.getByText("Agregar fotos del estado inicial del equipo"),
      ).toBeInTheDocument()
    },
    30000,
  )
})
