/**
 * Tarjeta "Garantías" de Configuración → Comprobantes (migración 402): términos
 * de garantía, ventana "por vencer" y aviso al cliente. Se guarda con la barra
 * de guardado del formulario, contra /api/configuracion/garantias, y solo si
 * cambió algo.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

const { refreshConfig } = vi.hoisted(() => ({ refreshConfig: vi.fn() }))
vi.mock("@/contexts/currency-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/contexts/currency-context")>()
  return { ...actual, useCurrency: () => ({ ...actual.useCurrency(), refreshConfig }) }
})

const CONFIG = {
  nombreEmpresa: "Taller Test",
  pais: "AR",
  moneda: "ARS",
  zonaHoraria: "America/Argentina/Buenos_Aires",
  garantiaDiasDefault: 30,
  ivaRegimen: "EXENTO",
}

function responder(garantias: Record<string, unknown>) {
  mockFetch.mockImplementation((url: string) =>
    Promise.resolve({
      ok: true,
      json: async () => (url === "/api/configuracion/garantias" ? garantias : CONFIG),
    })
  )
}

const putsA = (url: string) => mockFetch.mock.calls.filter(([u, init]) => u === url && init?.method === "PUT")

async function renderForm() {
  const { ConfiguracionForm } = await import("@/components/configuracion/configuracion-form")
  render(
    <ModalProvider>
      <ConfiguracionForm initialTab="comprobantes" />
    </ModalProvider>
  )
  return (await screen.findByLabelText(/Términos de garantía/i)) as HTMLTextAreaElement
}

describe("ConfiguracionForm: garantías", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    responder({ terminos: "No cubre golpes.", ventanaPorVencer: 10, avisoVencimiento: false })
  })

  it("muestra lo guardado, con el aviso apagado", async () => {
    const terminos = await renderForm()
    await waitFor(() => expect(terminos.value).toBe("No cubre golpes."))
    expect((screen.getByLabelText(/Ventana "por vencer"/i) as HTMLInputElement).value).toBe("10")
    expect(screen.getByRole("switch", { name: /Avisarle al cliente/i })).toHaveAttribute("aria-checked", "false")
  })

  it("sin cambios no escribe la configuración de garantías", async () => {
    const terminos = await renderForm()
    await waitFor(() => expect(terminos.value).toBe("No cubre golpes."))
    fireEvent.click(screen.getByRole("button", { name: /Guardar Cambios/i }))
    await waitFor(() => expect(putsA("/api/configuracion")).toHaveLength(1))
    expect(putsA("/api/configuracion/garantias")).toHaveLength(0)
  })

  it("guarda términos, ventana y aviso juntos con la barra de guardado", async () => {
    const terminos = await renderForm()
    await waitFor(() => expect(terminos.value).toBe("No cubre golpes."))
    fireEvent.change(terminos, { target: { value: "Nuevo texto" } })
    fireEvent.change(screen.getByLabelText(/Ventana "por vencer"/i), { target: { value: "14" } })
    fireEvent.click(screen.getByRole("switch", { name: /Avisarle al cliente/i }))
    fireEvent.click(screen.getByRole("button", { name: /Guardar Cambios/i }))
    await waitFor(() => expect(putsA("/api/configuracion/garantias")).toHaveLength(1))
    expect(JSON.parse(putsA("/api/configuracion/garantias")[0][1].body)).toEqual({
      terminos: "Nuevo texto",
      ventanaPorVencer: 14,
      avisoVencimiento: true,
    })
  })
})
