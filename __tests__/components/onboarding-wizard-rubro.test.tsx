/**
 * The rubro change from the business step: the shell shows the saved rubro at
 * once, re-reads the server props (tipos, vocabulary) and reloads the root
 * CurrencyProvider, so the next screen does not keep the old vocabulary.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { OnboardingWizard } from "@/components/onboarding/wizard/onboarding-wizard"
import type { OnboardingWizardProps } from "@/components/onboarding/wizard/types"
import { etiquetaRubro } from "@/components/onboarding/wizard/wizard-state"
import { json, routeFetch, wizardProps } from "./onboarding-wizard-fixtures"

const push = vi.fn()
const refresh = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }))

const refreshConfig = vi.fn()
vi.mock("@/contexts/currency-context", () => ({ useCurrency: () => ({ refreshConfig }) }))

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch
const RUBRO = "PUT /api/onboarding/rubro"

async function irANegocio(overrides: Partial<OnboardingWizardProps> = {}) {
  render(<OnboardingWizard {...wizardProps(overrides)} />)
  fireEvent.click(screen.getByRole("button", { name: /Comenzar/i }))
  await screen.findByText(/Personalizá tu negocio/i)
}

function cambiarA(nombre: RegExp) {
  fireEvent.click(screen.getByRole("button", { name: "Cambiar rubro" }))
  fireEvent.click(screen.getByRole("radio", { name: nombre }))
  fireEvent.click(screen.getByRole("button", { name: "Guardar rubro" }))
}

describe("OnboardingWizard — rubro change", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
  })

  it("shows the new rubro and reloads tipos and vocabulary", async () => {
    routeFetch(mockFetch, { [RUBRO]: [json({ rubro: "automotor", rubroDetalle: null, tiposActivos: 3 })] })
    await irANegocio()
    const etiquetaVieja = etiquetaRubro("electrodomesticos", null)
    expect(screen.getByText(etiquetaVieja)).toBeInTheDocument()

    cambiarA(/Taller mecánico/)

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(await screen.findByText("Taller mecánico / Automotor")).toBeInTheDocument()
    expect(screen.queryByText(etiquetaVieja)).not.toBeInTheDocument()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refreshConfig).toHaveBeenCalledTimes(1)
  })

  it("locks Cambiar after the server answers 409", async () => {
    routeFetch(mockFetch, { [RUBRO]: [json({ error: "Ya tenés órdenes reales" }, 409)] })
    await irANegocio()

    cambiarA(/Taller mecánico/)
    expect(await screen.findByRole("alert")).toHaveTextContent("Ya tenés órdenes reales")
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))

    await waitFor(() => expect(screen.getByRole("button", { name: "Cambiar rubro" })).toBeDisabled())
    expect(screen.getByText("Ya cargaste órdenes, así que el rubro queda como está.")).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })

  it("Cambiar is disabled from the start when the shop has real orders", async () => {
    await irANegocio({ ordenesRealesCount: 2 })

    expect(screen.getByRole("button", { name: "Cambiar rubro" })).toBeDisabled()
    expect(screen.getByText("Ya cargaste órdenes, así que el rubro queda como está.")).toBeInTheDocument()
  })
})
