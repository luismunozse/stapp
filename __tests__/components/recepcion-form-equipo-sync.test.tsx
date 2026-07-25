/**
 * Cubre el riesgo que la extraccion a construirEquipoPayload (ver
 * recepcion-payload.test.ts) no puede cubrir por si sola: que `fields` (react
 * -hook-form, via useFieldArray) y `sideState` (accesorios/campos extra/fotos)
 * se mantengan en el mismo indice cuando el mostrador agrega o quita un
 * equipo. Un desalineado aca manda, por ejemplo, los datos de un equipo a la
 * orden de otro sin ningun error visible.
 *
 * RecepcionForm depende de ClienteSelector (que monta ClienteForm, con un
 * useModal() sin proteccion — ver recepcion-gate.test.tsx) y de SignaturePad
 * (que monta react-signature-canvas, sin mock existente en todo __tests__/ y
 * sin soporte de canvas 2D en jsdom). Ninguno de los dos es relevante para lo
 * que este test verifica (el sync de arrays), asi que se mockean ambos —
 * mismo patron que orden-form-extracciones.test.tsx ya usa para ClienteSelector
 * — en vez de forzar un canvas real o tocar ClienteForm.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"

vi.mock("@/hooks/use-tipos-dispositivo", () => ({
  useTiposDispositivo: () => ({
    tipos: [
      {
        codigo: "CELULAR",
        nombre: "Celular",
        config: { accesorios: [], problemasComunes: [], marcas: [], camposExtra: [] },
      },
    ],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

// Mismo patron que orden-form-extracciones.test.tsx: se testea el sync de
// arrays de RecepcionForm, no la busqueda de clientes.
vi.mock("@/components/cotizaciones/cliente-selector", () => ({
  ClienteSelector: () => <div data-testid="cliente-selector-stub" />,
}))

// SignaturePad monta react-signature-canvas, que en jsdom no tiene un canvas
// 2D real. No hay ningun mock existente para esa libreria en __tests__/; en
// vez de improvisar uno a nivel canvas (fragil, atado a los internals de
// react-signature-canvas), se mockea el wrapper de la app, que es la interfaz
// estable que el resto del codigo consume.
vi.mock("@/components/firma/signature-pad", () => ({
  SignaturePad: () => <div data-testid="signature-pad-stub" />,
}))

describe("RecepcionForm — fields y sideState en el mismo indice al quitar un equipo", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: async () => [] } as Response)),
    )
  })

  it(
    "agregar un tercer equipo, llenar el equipo 2 (RHF y sideState) con algo distintivo y quitar el equipo 1 deja esos datos en el indice 0",
    async () => {
      const { RecepcionForm } = await import("@/components/ordenes/recepcion-form")
      render(
        <ModalProvider>
          <RecepcionForm />
        </ModalProvider>,
      )

      const dispositivoInputs = () => screen.getAllByPlaceholderText("Ej: iPhone 13")
      // El input de "otro accesorio" refleja sideState[index].otroAccesorio
      // directamente (prop `otro` de AccesoriosPicker) -- a diferencia de
      // dispositivo, que vive en react-hook-form. Verificar solo dispositivo
      // no probaria nada sobre sideState: useFieldArray ya reindexa sus
      // propios campos por si solo. Este input es el que de verdad ejercita
      // el sync manual de sideState.
      const otroAccesorioInputs = () => screen.getAllByPlaceholderText("Otro accesorio...")

      // Arranca con 2 equipos (el minimo).
      expect(dispositivoInputs()).toHaveLength(2)

      // Agregar un tercer equipo.
      fireEvent.click(screen.getByRole("button", { name: /Agregar otro equipo/i }))
      expect(dispositivoInputs()).toHaveLength(3)

      // Llenar el equipo 2 (indice 1) con valores distintivos: uno en RHF
      // (dispositivo) y uno en sideState (el texto de "otro accesorio", sin
      // llegar a confirmarlo con el boton "+" -- alcanza con que el input
      // controlado refleje sideState[1].otroAccesorio).
      fireEvent.change(dispositivoInputs()[1], { target: { value: "Samsung Distintivo" } })
      fireEvent.change(otroAccesorioInputs()[1], { target: { value: "Accesorio Distintivo" } })
      expect(dispositivoInputs()[1]).toHaveValue("Samsung Distintivo")
      expect(otroAccesorioInputs()[1]).toHaveValue("Accesorio Distintivo")

      // Quitar el equipo 1 (indice 0). El boton "Quitar equipo N" solo
      // aparece cuando puedeQuitar es true (fields.length > 2, ya el caso).
      const quitarEquipo1 = screen.getByRole("button", { name: "Quitar equipo 1" })
      fireEvent.click(quitarEquipo1)

      // Si fields y sideState se desincronizaran, alguno de los dos valores
      // distintivos aparaceria en el indice equivocado (o se perderia). Los
      // dos deben quedar en el indice 0 ahora que el equipo 1 original ya no
      // esta -- fields y sideState, en el mismo lugar.
      const dispositivoRestantes = dispositivoInputs()
      const otroAccesorioRestantes = otroAccesorioInputs()
      expect(dispositivoRestantes).toHaveLength(2)
      expect(otroAccesorioRestantes).toHaveLength(2)
      expect(dispositivoRestantes[0]).toHaveValue("Samsung Distintivo")
      expect(otroAccesorioRestantes[0]).toHaveValue("Accesorio Distintivo")
    },
    30000,
  )
})
