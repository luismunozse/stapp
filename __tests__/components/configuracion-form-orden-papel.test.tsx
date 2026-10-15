/**
 * Selector "Tamaño de hoja para las órdenes" (migration orden_formato_papel) in ConfiguracionForm.
 *
 * The workshop decides which sheet its orders are printed on: A4 stays the default, A5 and A6 are
 * opt-in. It is a NATIVE select on purpose: a Radix Select echoes an empty value when it is set while
 * closed and blanks the field (see the gotcha about it), and this one is saved with the rest of the form.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

// The provider that holds the default the print buttons show is refreshed after a save.
const { refreshConfig } = vi.hoisted(() => ({ refreshConfig: vi.fn() }))
vi.mock("@/contexts/currency-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/contexts/currency-context")>()
  return { ...actual, useCurrency: () => ({ ...actual.useCurrency(), refreshConfig }) }
})

const LABEL = /Tamaño de hoja para las órdenes/i

function configResponse(overrides: Record<string, any> = {}) {
  return {
    logoUrl: null, logoData: null, logoMime: null,
    nombreEmpresa: "Taller Test", telefono: "", direccion: "", ciudad: "",
    provincia: "", codigoPostal: "", pais: "AR", moneda: "ARS",
    zonaHoraria: "America/Argentina/Buenos_Aires",
    ivaPorcentaje: 0, cotizacionValidezDias: 30, cotizacionTerminos: "",
    recepcionTerminos: "", comprobanteTerminos: "",
    garantiaDiasDefault: 30, politicaAbandonoDiasDefault: 60,
    anticipoPorcentajeDefault: 50,
    moduloAgenda: false,
    vendedoresAdministranInventario: false,
    tecnicosOperanPos: false,
    comisionAplicaSinReparacion: false,
    ivaRegimen: "EXENTO", ivaTasa: 21, redondeoEfectivo: 0,
    ...overrides,
  }
}

async function renderForm(props: { allowEdit?: boolean } = {}) {
  const { ConfiguracionForm } = await import("@/components/configuracion/configuracion-form")
  render(
    <ModalProvider>
      <ConfiguracionForm initialTab="comprobantes" {...props} />
    </ModalProvider>,
  )
  return (await screen.findByLabelText(LABEL)) as HTMLSelectElement
}

function putBody() {
  const putCall = mockFetch.mock.calls.find(([, init]) => init?.method === "PUT")!
  return JSON.parse(putCall[1].body as string)
}

async function guardar() {
  fireEvent.click(screen.getByRole("button", { name: /Guardar Cambios/i }))
  await waitFor(() => {
    expect(mockFetch.mock.calls.find(([, init]) => init?.method === "PUT")).toBeDefined()
  })
}

describe("ConfiguracionForm: tamaño de hoja para las órdenes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue({ ok: true, json: async () => configResponse() })
  })

  it("is a native select with exactly A4, A5 and A6", async () => {
    const select = await renderForm()
    expect(select.tagName).toBe("SELECT")
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["A4", "A5", "A6"])
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "A4 (hoja entera)",
      "A5 (media hoja)",
      "A6 (un cuarto de hoja)",
    ])
  })

  it("comes on A4 when the answer carries no value (old server, or the column is not there yet)", async () => {
    const select = await renderForm()
    expect(select.value).toBe("A4")
  })

  it("reflects a saved A6", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => configResponse({ ordenFormatoPapel: "A6" }) })
    const a6 = await renderForm()
    expect(a6.value).toBe("A6")
  })

  it("reflects a saved A5", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => configResponse({ ordenFormatoPapel: "A5" }) })
    const a5 = await renderForm()
    expect(a5.value).toBe("A5")
  })

  it("says in one line, in plain words, that A6 is a quarter of an A4", async () => {
    await renderForm()
    expect(screen.getByText(/A6 es un cuarto de una hoja A4/i)).toBeInTheDocument()
  })

  it("choosing a size and saving sends it in the PUT", async () => {
    const select = await renderForm()

    fireEvent.change(select, { target: { value: "A6" } })
    expect(select.value).toBe("A6")
    await guardar()

    expect(putBody().ordenFormatoPapel).toBe("A6")
  })

  it("going back to A4 is sent as A4, not omitted", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => configResponse({ ordenFormatoPapel: "A5" }) })
    const select = await renderForm()

    fireEvent.change(select, { target: { value: "A4" } })
    await guardar()

    expect(putBody().ordenFormatoPapel).toBe("A4")
  })

  it("saving without touching it sends the value that was loaded (the form does not blank it)", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => configResponse({ ordenFormatoPapel: "A5" }) })
    await renderForm()

    await guardar()

    expect(putBody().ordenFormatoPapel).toBe("A5")
  })

  it("a successful save refreshes the configuration the rest of the app reads (the print buttons' default)", async () => {
    const select = await renderForm()
    expect(refreshConfig).not.toHaveBeenCalled()

    fireEvent.change(select, { target: { value: "A6" } })
    await guardar()

    await waitFor(() => expect(refreshConfig).toHaveBeenCalledTimes(1))
  })

  it("a failed save does not refresh anything", async () => {
    const select = await renderForm()
    mockFetch.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "PUT"
        ? { ok: false, status: 500, json: async () => ({ error: "boom" }) }
        : { ok: true, json: async () => configResponse() },
    )

    fireEvent.change(select, { target: { value: "A6" } })
    await guardar()
    await screen.findByText(/boom/)

    expect(refreshConfig).not.toHaveBeenCalled()
  })

  it("is disabled when the user cannot edit the configuration", async () => {
    const select = await renderForm({ allowEdit: false })
    expect(select).toBeDisabled()
  })
})
