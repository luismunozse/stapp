import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { CotizacionPublica } from "@/components/cotizaciones/cotizacion-publica"

/**
 * CotizacionPublica es la vista que abre el cliente/asegurador desde el link
 * publico. Un informe tecnico (cero items + veredicto IRREPARABLE/SIN_FALLA,
 * ver lib/cotizacion-informe.esInforme) no se aprueba ni se rechaza: se
 * emite. Esto es UX, no el guard -- los tres endpoints de aprobacion ya
 * rechazan una cotizacion sin items en el servidor.
 *
 * SignaturePad monta react-signature-canvas, que en jsdom no tiene un canvas
 * 2D real (mismo problema documentado en
 * __tests__/components/recepcion-form-equipo-sync.test.tsx). En vez de
 * stubear getContext, se mockea el wrapper de la app -- es la interfaz que
 * este componente conoce, no los internals de la libreria.
 */
vi.mock("@/components/firma/signature-pad", () => ({
  SignaturePad: () => <div data-testid="signature-pad-stub" />,
}))

const baseData = {
  id: "cot-1",
  numeroCotizacion: "COT-0001",
  estado: "ENVIADA",
  fechaVencimiento: null,
  notas: null,
  subtotal: 0,
  iva: 0,
  total: 0,
  createdAt: "2026-09-01T12:00:00.000Z",
  publicToken: "a".repeat(32),
  firmaAprobacion: null,
  firmaMime: null,
  fechaAprobacion: null,
  moneda: "ARS",
  zonaHoraria: "America/Argentina/Buenos_Aires",
  terminos: null,
  tipo: "PRESUPUESTO" as const,
  orden: null,
  cliente: { nombre: "Juan Pérez", telefono: null, email: null },
  organizacion: { nombre: "Taller Central", telefono: null, direccion: null, logoUrl: null },
}

const stubFetch = (data: Record<string, unknown>) => {
  const fn = vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: async () => data,
    } as Response)
  )
  vi.stubGlobal("fetch", fn)
  return fn
}

const renderPublica = () => render(<CotizacionPublica token={"a".repeat(32)} />)

describe("CotizacionPublica — informe técnico", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("con items:[] y veredicto IRREPARABLE no ofrece aprobar, rechazar ni firmar", async () => {
    stubFetch({
      ...baseData,
      items: [],
      veredicto: "IRREPARABLE",
      diagnosticoTecnico: "Placa madre con corrosión generalizada, sin reparación posible.",
      causaDano: "LIQUIDO",
      presentadoAnte: "La Segunda ART",
    })

    renderPublica()

    await waitFor(() => {
      expect(screen.getByText("COT-0001")).toBeInTheDocument()
    })

    expect(screen.queryByRole("button", { name: /Aprobar cotizacion/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Rechazar cotizacion/i })).not.toBeInTheDocument()
    expect(screen.queryByTestId("signature-pad-stub")).not.toBeInTheDocument()
  })

  it("con items no oculta aprobar, rechazar ni firmar", async () => {
    stubFetch({
      ...baseData,
      items: [
        {
          id: "item-1",
          descripcion: "Cambio de pantalla",
          cantidad: 1,
          precioUnitario: 50000,
          subtotal: 50000,
        },
      ],
      subtotal: 50000,
      total: 50000,
    })

    renderPublica()

    const aprobarBtn = await screen.findByRole("button", { name: /Aprobar cotizacion/i })
    const rechazarBtn = screen.getByRole("button", { name: /Rechazar cotizacion/i })
    expect(aprobarBtn).toBeInTheDocument()
    expect(rechazarBtn).toBeInTheDocument()

    // La firma vive dentro del panel de aprobación, que solo se monta al
    // hacer click en "Aprobar cotizacion".
    fireEvent.click(aprobarBtn)
    expect(await screen.findByTestId("signature-pad-stub")).toBeInTheDocument()
  })

  it("muestra el dictamen (veredicto, causa, diagnóstico) y la entidad ante la que se presenta", async () => {
    stubFetch({
      ...baseData,
      items: [],
      veredicto: "IRREPARABLE",
      diagnosticoTecnico: "Placa madre con corrosión generalizada, sin reparación posible.",
      causaDano: "LIQUIDO",
      presentadoAnte: "La Segunda ART",
    })

    renderPublica()

    expect(await screen.findByText("Irreparable")).toBeInTheDocument()
    expect(screen.getByText("Contacto con líquido")).toBeInTheDocument()
    expect(
      screen.getByText("Placa madre con corrosión generalizada, sin reparación posible.")
    ).toBeInTheDocument()
    expect(screen.getByText("La Segunda ART")).toBeInTheDocument()
    expect(screen.getByText("Para ser presentado ante")).toBeInTheDocument()
  })

  // FIX 3: antes, el gate era `!!data.veredicto || !!data.presentadoAnte` --
  // una cotizacion comun (con items) donde el tecnico solo cargo el
  // diagnostico quedaba guardada pero invisible en el link publico, mismo bug
  // que en lib/pdf.ts.
  it("con items y SOLO diagnostico (sin veredicto, causa ni entidad) igual muestra la tarjeta de dictamen", async () => {
    stubFetch({
      ...baseData,
      items: [
        {
          id: "item-1",
          descripcion: "Cambio de pantalla",
          cantidad: 1,
          precioUnitario: 50000,
          subtotal: 50000,
        },
      ],
      subtotal: 50000,
      total: 50000,
      diagnosticoTecnico: "Se detecta oxidación en el conector de carga por exposición a humedad.",
    })

    renderPublica()

    // El diagnostico cuenta como contenido de dictamen (igual que en
    // lib/pdf.ts): el titulo es "Dictamen técnico", no "Presentación" -- ese
    // titulo queda reservado para cuando lo UNICO cargado es la entidad.
    expect(await screen.findByText("Dictamen técnico")).toBeInTheDocument()
    expect(
      screen.getByText("Se detecta oxidación en el conector de carga por exposición a humedad.")
    ).toBeInTheDocument()
  })
})
