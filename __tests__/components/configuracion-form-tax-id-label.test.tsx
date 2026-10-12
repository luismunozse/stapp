import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

const baseConfig = {
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
  cuit: "",
  condicionIva: "",
  domicilioFiscal: "",
  ingresosBrutos: "",
  inicioActividades: "",
  cbuAlias: "",
  mediosPagoTexto: "",
  plazoPagoDias: 0,
}

async function renderForm(pais: string) {
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ...baseConfig, pais }) })
  const { ConfiguracionForm } = await import("@/components/configuracion/configuracion-form")
  render(
    <ModalProvider>
      <ConfiguracionForm />
    </ModalProvider>
  )
  await screen.findByText("Datos fiscales y de cobro")
}

describe("ConfiguracionForm — ID fiscal de la organizacion segun el pais", () => {
  beforeEach(() => vi.clearAllMocks())

  it("Argentina: CUIT con su placeholder", async () => {
    await renderForm("AR")
    expect(screen.getByLabelText("CUIT")).toHaveAttribute("placeholder", "20-12345678-9")
  })

  it("Espana: NIF con su placeholder, sin CUIT", async () => {
    await renderForm("ES")
    expect(screen.getByLabelText("NIF")).toHaveAttribute("placeholder", "B12345678")
    expect(screen.queryByLabelText("CUIT")).not.toBeInTheDocument()
  })
})
