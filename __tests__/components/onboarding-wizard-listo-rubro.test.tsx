/**
 * A finished practice lands on Listo, which used to have no way back: a shop
 * that noticed the wrong rubro there could not reach "Tu rubro · Cambiar".
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { OnboardingWizard } from "@/components/onboarding/wizard/onboarding-wizard"
import { json, practica, routeFetch, wizardProps } from "./onboarding-wizard-fixtures"

const push = vi.fn()
const refresh = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }))

const refreshConfig = vi.fn()
vi.mock("@/contexts/currency-context", () => ({ useCurrency: () => ({ refreshConfig }) }))

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

const LISTO = "¡Listo! Ya viste cómo funciona"
const NEGOCIO = /Personalizá tu negocio/i
const terminada = () => wizardProps({ practica: practica({ estado: "ENTREGADO_SIN_COBRO" }) })

describe("OnboardingWizard — rubro from Listo", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
    routeFetch(mockFetch, {})
  })

  it("Listo offers the way back to the rubro without completing the onboarding", async () => {
    render(<OnboardingWizard {...terminada()} />)
    expect(screen.getByText(LISTO)).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Cambialo" }))

    expect(await screen.findByText(NEGOCIO)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Cambiar rubro" })).toBeEnabled()
    expect(push).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("with the practice still finished, going forward again ends on Listo, not on an empty practice step", async () => {
    render(<OnboardingWizard {...terminada()} />)
    fireEvent.click(screen.getByRole("button", { name: "Cambialo" }))
    await screen.findByText(NEGOCIO)

    fireEvent.click(screen.getByRole("button", { name: /Siguiente/ }))
    fireEvent.click(await screen.findByRole("button", { name: "Todavía no, quiero practicar" }))

    expect(await screen.findByText(LISTO)).toBeInTheDocument()
  })

  it("after a rubro change the practice is gone, so practicing starts a new one", async () => {
    routeFetch(mockFetch, { "PUT /api/onboarding/rubro": [json({ rubro: "automotor", rubroDetalle: null, tiposActivos: 3 })] })
    render(<OnboardingWizard {...terminada()} />)
    fireEvent.click(screen.getByRole("button", { name: "Cambialo" }))
    await screen.findByText(NEGOCIO)

    fireEvent.click(screen.getByRole("button", { name: "Cambiar rubro" }))
    fireEvent.click(screen.getByRole("radio", { name: /Taller mecánico/ }))
    fireEvent.click(screen.getByRole("button", { name: "Guardar rubro" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole("button", { name: /Siguiente/ }))
    fireEvent.click(await screen.findByRole("button", { name: "Todavía no, quiero practicar" }))

    expect(await screen.findByText("Cargá tu orden de práctica")).toBeInTheDocument()
  })
})
