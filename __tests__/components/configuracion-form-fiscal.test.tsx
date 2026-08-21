// __tests__/components/configuracion-form-fiscal.test.tsx
/**
 * Covers the new "Datos fiscales y de cobro" card added to ConfiguracionForm
 * (RC Task 6): renders its fields (prefilled from GET /api/configuracion),
 * and submits them as part of the existing PUT payload on "Guardar Cambios".
 *
 * ConfiguracionForm calls useModal() unconditionally at the top of the
 * component (used by handleDeleteLogo), so it must be rendered inside a
 * ModalProvider — same requirement as checklist-template-usage-disable.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

const configResponse = {
  logoUrl: null,
  logoData: null,
  logoMime: null,
  nombreEmpresa: "Taller Test",
  telefono: "",
  direccion: "",
  ciudad: "",
  provincia: "",
  codigoPostal: "",
  pais: "AR",
  moneda: "ARS",
  zonaHoraria: "America/Argentina/Buenos_Aires",
  ivaPorcentaje: 0,
  cotizacionValidezDias: 30,
  cotizacionTerminos: "",
  recepcionTerminos: "",
  comprobanteTerminos: "",
  garantiaDiasDefault: 30,
  politicaAbandonoDiasDefault: 60,
  anticipoPorcentajeDefault: 50,
  moduloAgenda: false,
  vendedoresAdministranInventario: false,
  comisionAplicaSinReparacion: false,
  ivaRegimen: "EXENTO",
  ivaTasa: 21,
  redondeoEfectivo: 0,
  // Fiscal identity / collection fields (migration 295) prefilled from a
  // prior save — the card must render them, not just accept new input.
  cuit: "30-71234567-8",
  condicionIva: "Responsable Inscripto",
  domicilioFiscal: "Av. Siempreviva 742, Córdoba",
  // "Remito formato clásico" fields (migration 297) prefilled from a prior
  // save — the card must render them, not just accept new input.
  ingresosBrutos: "902-123456-7",
  inicioActividades: "01/2020",
  cbuAlias: "taller.alias.mp",
  mediosPagoTexto: "Efectivo, transferencia",
  plazoPagoDias: 15,
}

describe("ConfiguracionForm — Datos fiscales y de cobro", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue({ ok: true, json: async () => configResponse })
  })

  it("renders the new card with all six fields prefilled from the API response", async () => {
    const { ConfiguracionForm } = await import("@/components/configuracion/configuracion-form")
    render(
      <ModalProvider>
        <ConfiguracionForm />
      </ModalProvider>
    )

    await screen.findByText("Datos fiscales y de cobro")

    expect(screen.getByLabelText("CUIT")).toHaveValue("30-71234567-8")
    expect(screen.getByLabelText("Domicilio fiscal")).toHaveValue("Av. Siempreviva 742, Córdoba")
    expect(screen.getByLabelText("Ingresos brutos")).toHaveValue("902-123456-7")
    expect(screen.getByLabelText("Inicio de actividades")).toHaveValue("01/2020")
    expect(screen.getByLabelText("CBU o alias")).toHaveValue("taller.alias.mp")
    expect(screen.getByLabelText("Medios de pago aceptados")).toHaveValue("Efectivo, transferencia")
    expect(screen.getByLabelText("Plazo de pago (días)")).toHaveValue(15)
    // Radix Select renders the selected item's label as text inside the trigger.
    expect(screen.getByText("Responsable Inscripto")).toBeInTheDocument()
  })

  it("submits edited fiscal fields in the PUT payload on Guardar Cambios", async () => {
    const { ConfiguracionForm } = await import("@/components/configuracion/configuracion-form")
    render(
      <ModalProvider>
        <ConfiguracionForm />
      </ModalProvider>
    )

    await screen.findByText("Datos fiscales y de cobro")

    fireEvent.change(screen.getByLabelText("CUIT"), { target: { value: "30-99999999-1" } })
    fireEvent.change(screen.getByLabelText("Domicilio fiscal"), { target: { value: "Otra Calle 456" } })
    fireEvent.change(screen.getByLabelText("Ingresos brutos"), { target: { value: "902-987654-3" } })
    fireEvent.change(screen.getByLabelText("Inicio de actividades"), { target: { value: "05/2019" } })
    fireEvent.change(screen.getByLabelText("CBU o alias"), { target: { value: "nuevo.alias" } })
    fireEvent.change(screen.getByLabelText("Medios de pago aceptados"), { target: { value: "Efectivo" } })
    fireEvent.change(screen.getByLabelText("Plazo de pago (días)"), { target: { value: "30" } })

    fireEvent.click(screen.getByRole("button", { name: /Guardar Cambios/i }))

    await waitFor(() => {
      const putCall = mockFetch.mock.calls.find(([, init]) => init?.method === "PUT")
      expect(putCall).toBeDefined()
    })

    const putCall = mockFetch.mock.calls.find(([, init]) => init?.method === "PUT")!
    const body = JSON.parse(putCall[1].body as string)
    expect(body.cuit).toBe("30-99999999-1")
    expect(body.condicionIva).toBe("Responsable Inscripto") // unchanged from fetched config
    expect(body.domicilioFiscal).toBe("Otra Calle 456")
    expect(body.ingresosBrutos).toBe("902-987654-3")
    expect(body.inicioActividades).toBe("05/2019")
    expect(body.cbuAlias).toBe("nuevo.alias")
    expect(body.mediosPagoTexto).toBe("Efectivo")
    expect(body.plazoPagoDias).toBe("30")
  })

  it("renders the empty-option placeholder for Condición frente al IVA when unset", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ...configResponse, condicionIva: "" }),
    })
    const { ConfiguracionForm } = await import("@/components/configuracion/configuracion-form")
    render(
      <ModalProvider>
        <ConfiguracionForm />
      </ModalProvider>
    )

    await screen.findByText("Datos fiscales y de cobro")
    expect(screen.getByText("Sin especificar")).toBeInTheDocument()
  })
})
