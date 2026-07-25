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
      {
        // Tipo con un campo extra de cada `tipo` soportado por
        // CamposExtraFields (text, select, buttons, counter), para poder
        // ejercitar las cuatro ramas de renderCampoExtra.
        codigo: "COMPUTADORA",
        nombre: "Computadora",
        config: {
          campos: {
            imei: { visible: false },
            password: { visible: false },
            color: { visible: true },
            marca: { visible: true },
          },
          accesorios: [],
          problemasComunes: [],
          marcas: [],
          camposExtra: [
            { key: "procesador", label: "Procesador", tipo: "text", placeholder: "Ej: i5 10ma gen" },
            { key: "tipoPc", label: "Tipo de PC", tipo: "select", opciones: ["Notebook", "Desktop"] },
            { key: "ram", label: "RAM", tipo: "buttons", opciones: ["4GB", "8GB", "16GB"] },
            { key: "puertosUsb", label: "Cantidad de puertos USB", tipo: "counter", min: 0, max: 3 },
          ],
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

  // CamposExtraFields solo renderiza cuando el tipo elegido tiene camposExtra
  // (con !usarComoDispositivo). El fixture "Celular" de arriba usa
  // camposExtra: [], asi que este test no la ejercita: hace falta un tipo
  // aparte (Computadora, definido en el mock) con un campo de cada
  // `campo.tipo` para probar las cuatro ramas de renderCampoExtra.
  it(
    "en un tipo con camposExtra, CamposExtraFields renderiza las 4 variantes: text, select, buttons y counter",
    async () => {
      const { OrdenForm } = await import("@/components/ordenes/orden-form")
      render(
        <ModalProvider>
          <OrdenForm onClose={vi.fn()} onSuccess={vi.fn()} />
        </ModalProvider>,
      )

      fireEvent.click(screen.getByRole("button", { name: "Elegir cliente de prueba" }))
      fireEvent.click(screen.getByRole("button", { name: "Computadora" }))

      // tipo: "text"
      expect(screen.getByText("Procesador")).toBeInTheDocument()
      const procesadorInput = screen.getByPlaceholderText("Ej: i5 10ma gen")
      expect(procesadorInput).toBeInTheDocument()
      fireEvent.change(procesadorInput, { target: { value: "i7 12va gen" } })
      expect(procesadorInput).toHaveValue("i7 12va gen")

      // tipo: "select" (no se abre el dropdown de Radix en jsdom; se
      // verifica el label y el trigger con su placeholder visible).
      expect(screen.getByText("Tipo de PC")).toBeInTheDocument()
      expect(screen.getByText("Seleccionar...")).toBeInTheDocument()

      // tipo: "buttons"
      expect(screen.getByText("RAM")).toBeInTheDocument()
      const ram8gb = screen.getByRole("button", { name: "8GB" })
      expect(ram8gb).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "16GB" })).toBeInTheDocument()
      fireEvent.click(ram8gb)

      // tipo: "counter"
      expect(screen.getByText("Cantidad de puertos USB")).toBeInTheDocument()
      const contadorCero = screen.getByRole("button", { name: "0" })
      expect(contadorCero).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "3" })).toBeInTheDocument()
      fireEvent.click(contadorCero)
    },
    30000,
  )
})
