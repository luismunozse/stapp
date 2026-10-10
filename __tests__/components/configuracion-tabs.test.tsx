// __tests__/components/configuracion-tabs.test.tsx
/**
 * The configuration page is organised into tabs. ConfiguracionForm owns the
 * <Tabs> (it owns all form state); the server page injects the nav cards and
 * the security block as slots. Covers: tab triggers, default/initial tab,
 * URL sync via history.replaceState, state surviving a tab switch
 * (forceMount) and the sticky save bar visibility per tab.
 */
import { useState } from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"
import { parseConfigTab } from "@/components/configuracion/config-tabs"

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
  cuit: "",
  condicionIva: "",
  domicilioFiscal: "",
  ingresosBrutos: "",
  inicioActividades: "",
  cbuAlias: "",
  mediosPagoTexto: "",
  plazoPagoDias: null,
}

const LABELS = ["Secciones", "Empresa", "Facturación", "Comprobantes", "Avisos", "Seguridad"]

// Slot with its own local state: only forceMount keeps it alive across tab switches.
function StatefulSlot() {
  const [value, setValue] = useState("")
  return <input aria-label="slot-input" value={value} onChange={(e) => setValue(e.target.value)} />
}

function tree(ConfiguracionForm: typeof import("@/components/configuracion/configuracion-form").ConfiguracionForm, props: { initialTab?: string; allowEdit?: boolean }) {
  return (
    <ModalProvider>
      <ConfiguracionForm
        {...props}
        secciones={<div>slot-secciones</div>}
        seguridad={
          <div>
            <span>slot-seguridad</span>
            <StatefulSlot />
          </div>
        }
      />
    </ModalProvider>
  )
}

async function renderForm(props: { initialTab?: string; allowEdit?: boolean } = {}) {
  const { ConfiguracionForm } = await import("@/components/configuracion/configuracion-form")
  const utils = render(tree(ConfiguracionForm, props))
  // Wait for the config fetch to settle (the form panels show a spinner until then).
  await screen.findByLabelText("Nombre de la Empresa")
  return utils
}

describe("parseConfigTab", () => {
  it("falls back to secciones for missing or invalid values", () => {
    expect(parseConfigTab(undefined)).toBe("secciones")
    expect(parseConfigTab("nope")).toBe("secciones")
    expect(parseConfigTab(["facturacion", "empresa"])).toBe("facturacion")
    expect(parseConfigTab("comprobantes")).toBe("comprobantes")
    expect(parseConfigTab("avisos")).toBe("avisos")
  })

  it("maps the legacy modulos value to empresa", () => {
    expect(parseConfigTab("modulos")).toBe("empresa")
  })
})

describe("ConfiguracionForm — tabs", () => {
  let replaceStateSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue({ ok: true, json: async () => configResponse })
    replaceStateSpy = vi.spyOn(window.history, "replaceState")
  })

  afterEach(() => {
    replaceStateSpy.mockRestore()
  })

  it("renders the six tab triggers and defaults to Secciones", async () => {
    await renderForm()

    const tabs = screen.getAllByRole("tab")
    expect(tabs.map((t) => t.textContent)).toEqual(LABELS)
    expect(screen.getByRole("tab", { name: "Secciones" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByText("slot-secciones")).toBeVisible()
    expect(screen.getByLabelText("Nombre de la Empresa")).not.toBeVisible()
  })

  it("honours initialTab", async () => {
    await renderForm({ initialTab: "facturacion" })

    expect(screen.getByRole("tab", { name: "Facturación" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByLabelText("Régimen de IVA")).toBeVisible()
    expect(screen.getByText("slot-secciones")).not.toBeVisible()
  })

  it("syncs the active tab to the URL with replaceState, keeping other params", async () => {
    window.history.replaceState(null, "", "/configuracion?totp=ok")
    replaceStateSpy.mockClear()
    await renderForm()

    fireEvent.click(screen.getByRole("tab", { name: "Comprobantes" }))

    expect(replaceStateSpy).toHaveBeenCalled()
    const url = String(replaceStateSpy.mock.calls.at(-1)?.[2])
    expect(url).toContain("tab=comprobantes")
    expect(url).toContain("totp=ok")
  })

  it("keeps local state of an inactive panel when switching away and back (forceMount)", async () => {
    await renderForm({ initialTab: "seguridad" })

    fireEvent.change(screen.getByLabelText("slot-input"), { target: { value: "borrador" } })

    fireEvent.click(screen.getByRole("tab", { name: "Empresa" }))
    // Still in the DOM, just hidden.
    const hiddenInput = screen.getByLabelText("slot-input")
    expect(hiddenInput).not.toBeVisible()
    expect(hiddenInput.closest("[role='tabpanel']")).toHaveAttribute("hidden")

    fireEvent.click(screen.getByRole("tab", { name: "Seguridad" }))
    expect(screen.getByLabelText("slot-input")).toHaveValue("borrador")
    expect(screen.getByLabelText("slot-input")).toBeVisible()
  })

  it("resyncs the active tab when initialTab changes without remounting", async () => {
    const { ConfiguracionForm } = await import("@/components/configuracion/configuracion-form")
    const { rerender } = render(tree(ConfiguracionForm, { initialTab: "empresa" }))
    await screen.findByLabelText("Nombre de la Empresa")
    fireEvent.change(screen.getByLabelText("Nombre de la Empresa"), { target: { value: "Sin guardar" } })

    rerender(tree(ConfiguracionForm, { initialTab: "secciones" }))

    expect(screen.getByRole("tab", { name: "Secciones" })).toHaveAttribute("aria-selected", "true")
    // No remount: unsaved edit survives.
    expect(screen.getByLabelText("Nombre de la Empresa")).toHaveValue("Sin guardar")
  })

  it("puts Módulos opcionales in Empresa and only notifications in Avisos", async () => {
    await renderForm({ initialTab: "empresa" })
    const modulos = screen.getByText("Módulos opcionales")
    expect(modulos).toBeVisible()
    expect(modulos.closest("[role='tabpanel']")).toBe(screen.getByLabelText("Nombre de la Empresa").closest("[role='tabpanel']"))
  })

  it("shows the save bar only on form tabs", async () => {
    await renderForm()

    // Secciones: no save bar
    expect(screen.queryByRole("button", { name: /Guardar Cambios/ })).not.toBeInTheDocument()

    for (const label of ["Empresa", "Facturación", "Comprobantes"]) {
      fireEvent.click(screen.getByRole("tab", { name: label }))
      expect(screen.getByRole("button", { name: /Guardar Cambios/ })).toBeInTheDocument()
    }

    for (const label of ["Avisos", "Seguridad"]) {
      fireEvent.click(screen.getByRole("tab", { name: label }))
      expect(screen.queryByRole("button", { name: /Guardar Cambios/ })).not.toBeInTheDocument()
    }
  })

  it("saves the whole form from the sticky bar and shows the result next to it", async () => {
    await renderForm({ initialTab: "empresa" })

    fireEvent.change(screen.getByLabelText("Nombre de la Empresa"), { target: { value: "Nuevo" } })
    fireEvent.click(screen.getByRole("button", { name: /Guardar Cambios/ }))

    const status = await screen.findByText("Configuración guardada exitosamente")
    expect(status.closest("[data-testid='config-save-bar']")).not.toBeNull()

    await waitFor(() => {
      const put = mockFetch.mock.calls.find(([, init]) => init?.method === "PUT")
      expect(put).toBeDefined()
      expect(JSON.parse(put![1].body).nombreEmpresa).toBe("Nuevo")
    })
  })
})
