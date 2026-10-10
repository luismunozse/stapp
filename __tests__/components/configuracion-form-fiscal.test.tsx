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
import { toast } from "sonner"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

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
        <ConfiguracionForm initialTab="facturacion" />
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
        <ConfiguracionForm initialTab="facturacion" />
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
        <ConfiguracionForm initialTab="facturacion" />
      </ModalProvider>
    )

    await screen.findByText("Datos fiscales y de cobro")
    expect(screen.getByText("Sin especificar")).toBeInTheDocument()
  })
})

describe("ConfiguracionForm — toggle de facturación electrónica", () => {
  const LABEL = /Activar facturación electrónica/i
  const putCalls = () => mockFetch.mock.calls.filter(([, init]) => init?.method === "PUT")

  // GET devuelve la config (con el toggle según `persistido`); el PUT lo maneja
  // cada test. Cualquier otro GET (credenciales) responde vacío.
  function montar(persistido: boolean, put: () => Promise<unknown>) {
    mockFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (init?.method === "PUT") return put()
      if (url === "/api/configuracion") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ...configResponse,
            facturacionElectronicaDisponible: true,
            facturacionElectronicaHabilitada: persistido,
          }),
        })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
  }

  const eco = (valor: boolean) =>
    Promise.resolve({ ok: true, json: async () => ({ facturacionElectronicaHabilitada: valor }) })

  async function renderizar() {
    const { ConfiguracionForm } = await import("@/components/configuracion/configuracion-form")
    render(
      <ModalProvider>
        <ConfiguracionForm initialTab="facturacion" />
      </ModalProvider>
    )
    return (await screen.findByLabelText(LABEL)) as HTMLInputElement
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("shows the autosave hint", async () => {
    montar(false, () => eco(true))
    await renderizar()
    expect(screen.getByText("Se guarda al tocarlo.")).toBeInTheDocument()
  })

  it("ticking sends exactly one PUT with only the toggle", async () => {
    montar(false, () => eco(true))
    const box = await renderizar()
    fireEvent.click(box)
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Facturación electrónica activada"))
    expect(putCalls()).toHaveLength(1)
    const [url, init] = putCalls()[0]
    expect(url).toBe("/api/configuracion")
    expect(JSON.parse(init.body as string)).toEqual({ facturacionElectronicaHabilitada: true })
    expect(box.checked).toBe(true)
  })

  it("unticking sends false", async () => {
    montar(true, () => eco(false))
    const box = await renderizar()
    await waitFor(() => expect(box.checked).toBe(true))
    fireEvent.click(box)
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Facturación electrónica desactivada"))
    expect(JSON.parse(putCalls()[0][1].body as string)).toEqual({ facturacionElectronicaHabilitada: false })
    expect(box.checked).toBe(false)
  })

  it("reverts to the persisted value and toasts an error when the PUT is not ok", async () => {
    montar(false, () => Promise.resolve({ ok: false, json: async () => ({ error: "boom" }) }))
    const box = await renderizar()
    fireEvent.click(box)
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(box.checked).toBe(false)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("reverts when the PUT is ok but the echo differs from what was sent", async () => {
    montar(false, () => eco(false))
    const box = await renderizar()
    fireEvent.click(box)
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(box.checked).toBe(false)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("reverts to the last confirmed value, not to the negation of the click", async () => {
    // 1st PUT confirms true; 2nd PUT fails -> must go back to true.
    let n = 0
    montar(false, () => (n++ === 0 ? eco(true) : Promise.reject(new Error("net"))))
    const box = await renderizar()
    fireEvent.click(box)
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1))
    fireEvent.click(box)
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(box.checked).toBe(true)
  })

  it("disables the checkbox while the request is pending", async () => {
    let resolver!: (v: unknown) => void
    montar(false, () => new Promise((r) => { resolver = r }))
    const box = await renderizar()
    fireEvent.click(box)
    await waitFor(() => expect(box).toBeDisabled())
    resolver({ ok: true, json: async () => ({ facturacionElectronicaHabilitada: true }) })
    await waitFor(() => expect(box).not.toBeDisabled())
  })

  it("global Guardar Cambios no longer sends the toggle", async () => {
    montar(true, () => eco(true))
    await renderizar()
    fireEvent.click(screen.getByRole("button", { name: /Guardar Cambios/i }))
    await waitFor(() => expect(putCalls()).toHaveLength(1))
    const body = JSON.parse(putCalls()[0][1].body as string)
    expect(body).not.toHaveProperty("facturacionElectronicaHabilitada")
    expect(body.cuit).toBe("30-71234567-8")
  })

  // Un GET de fetchConfig en vuelo no puede pisar el toggle: el GET trae el
  // valor de antes de que el PUT se confirmara.
  function montarControlado(puts: Array<() => Promise<unknown>>) {
    const gets: Array<(v: unknown) => void> = []
    const configGet = (valor: boolean) => ({
      ok: true,
      json: async () => ({ ...configResponse, facturacionElectronicaDisponible: true, facturacionElectronicaHabilitada: valor }),
    })
    let primero = true
    let p = 0
    mockFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (init?.method === "PUT") return puts[p++]()
      if (url === "/api/configuracion") {
        if (primero) {
          primero = false
          return Promise.resolve(configGet(false))
        }
        return new Promise((r) => gets.push(r))
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    return { gets, configGet }
  }

  it("a stale config GET started before the tick does not undo the toggle", async () => {
    const { gets, configGet } = montarControlado([() => eco(false), () => eco(true), () => Promise.reject(new Error("net"))])
    const box = await renderizar()
    fireEvent.click(screen.getByRole("button", { name: /Guardar Cambios/i }))
    await waitFor(() => expect(gets).toHaveLength(1)) // fetchConfig pending
    fireEvent.click(box)
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1))
    gets[0](configGet(false))
    await new Promise((r) => setTimeout(r, 50))
    expect(box.checked).toBe(true)
    fireEvent.click(box) // failing untick must go back to the confirmed true
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(box.checked).toBe(true)
  })

  it("a config GET issued while the toggle PUT is pending does not undo it", async () => {
    let resolverPut!: (v: unknown) => void
    const { gets, configGet } = montarControlado([() => new Promise((r) => { resolverPut = r }), () => eco(false)])
    const box = await renderizar()
    fireEvent.click(box)
    await waitFor(() => expect(box).toBeDisabled())
    fireEvent.click(screen.getByRole("button", { name: /Guardar Cambios/i }))
    await waitFor(() => expect(gets).toHaveLength(1))
    resolverPut({ ok: true, json: async () => ({ facturacionElectronicaHabilitada: true }) })
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1))
    gets[0](configGet(false))
    await new Promise((r) => setTimeout(r, 50))
    expect(box.checked).toBe(true)
  })
})
