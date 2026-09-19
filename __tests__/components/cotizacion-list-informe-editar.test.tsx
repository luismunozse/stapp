// __tests__/components/cotizacion-list-informe-editar.test.tsx
//
// FIX 1 (BLOCKER): cotizacion-list.tsx armaba `initialData` para el formulario
// de edicion campo por campo, y se olvidaba de veredicto/diagnosticoTecnico/
// causaDano/presentadoAnte. El taller que emitia un informe tecnico, clickeaba
// "Editar" y veia la seccion "Informe tecnico" en blanco: el dictamen parecia
// perdido. Este test cubre la COSTURA real que el test de CotizacionForm no
// cubre -- ese test le pasa `initialData` ya armado a mano, nunca pasa por el
// mapeo de cotizacion-list.tsx que fue el que tenia el bug.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"
import { CotizacionList } from "@/components/cotizaciones/cotizacion-list"

const swrMock = vi.hoisted(() =>
  vi.fn(() => ({ data: [] as any[], isLoading: false, mutate: vi.fn() }))
)
vi.mock("swr", () => ({ default: swrMock }))

vi.mock("@/hooks/use-subscription", () => ({
  useHasFeature: () => ({ hasFeature: true, loading: false }),
}))

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({
    formatPrice: (n: number) => `$${n}`,
    formatDate: (d: string) => String(d),
  }),
  useTerminologia: () => (key: string) => key,
}))

// jsdom no implementa la API de pointer capture que usa @radix-ui/react-select
// al seleccionar un item con click (mismo polyfill que
// cotizacion-form-informe.test.tsx).
if (typeof Element !== "undefined") {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {}
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }
}

/** Cotizacion tal como la devuelve GET /api/cotizaciones (formatCotizacion en
 *  app/api/cotizaciones/route.ts) para un informe tecnico ya emitido: cero
 *  items, veredicto de cierre, diagnostico, causa y entidad cargados. */
const cotizacionConDictamen = {
  id: "cot-1",
  numeroCotizacion: "COT-0001",
  estado: "BORRADOR",
  fechaVencimiento: null,
  notas: null,
  subtotal: 0,
  iva: 0,
  total: 0,
  createdAt: "2026-09-01T12:00:00.000Z",
  publicToken: null,
  firmaAprobacion: null,
  firmaMime: null,
  fechaAprobacion: null,
  veredicto: "IRREPARABLE",
  diagnosticoTecnico: "Placa madre con corrosión generalizada, sin reparación posible.",
  causaDano: "LIQUIDO",
  presentadoAnte: "La Segunda ART",
  items: [],
}

describe("CotizacionList — Editar reabre el dictamen del informe tecnico", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    swrMock.mockReturnValueOnce({
      data: [cotizacionConDictamen],
      isLoading: false,
      mutate: vi.fn(),
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) } as Response))
    )
  })

  it("clickear Editar precarga veredicto, diagnostico, causa y entidad (no solo notas/items/vencimiento)", async () => {
    render(
      <ModalProvider>
        <CotizacionList ordenId="orden-1" mostrarCostos={false} />
      </ModalProvider>
    )

    fireEvent.click(await screen.findByRole("button", { name: "Editar" }))

    expect(await screen.findByRole("button", { name: "Irreparable" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
    expect(screen.getByLabelText("Diagnóstico del informe técnico")).toHaveValue(
      "Placa madre con corrosión generalizada, sin reparación posible."
    )
    expect(screen.getByLabelText("Causa probable del daño")).toHaveTextContent(
      "Contacto con líquido"
    )
    expect(screen.getByLabelText("Para ser presentado ante")).toHaveValue("La Segunda ART")

    // Sin items, es un informe: la seccion Ítems no se muestra, y el aviso
    // (sin conteo, porque no hay nada cargado que perder) esta presente.
    expect(screen.queryByText("Ítems")).not.toBeInTheDocument()
    expect(
      screen.getByText("Este documento se va a emitir como informe técnico, sin presupuesto ni ítems.")
    ).toBeInTheDocument()
  })
})
