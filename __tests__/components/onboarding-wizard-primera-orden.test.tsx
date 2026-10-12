/**
 * "¿Tenés un equipo para cargar ahora?" — the fork after the business step.
 *
 * "Sí" must complete onboarding with camino "real" and navigate once to
 * /ordenes?nueva=1 (#445: two competing navigations and a param nobody read).
 * "Omitir" completes with camino "omitido". The old sample-data button and the
 * "Primer cliente" step are gone.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { OnboardingWizard } from "@/components/onboarding/wizard/onboarding-wizard"
import type { OnboardingWizardProps } from "@/components/onboarding/wizard/types"
import { resolveTerminologia } from "@/lib/terminologia"
import { bodyOf, callsTo, json, wizardProps } from "./onboarding-wizard-fixtures"

const push = vi.fn()
const refresh = vi.fn()
const router = { push, refresh }
vi.mock("next/navigation", () => ({ useRouter: () => router }))

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

async function irAPregunta(overrides: Partial<OnboardingWizardProps> = {}) {
  render(<OnboardingWizard {...wizardProps(overrides)} />)
  fireEvent.click(screen.getByRole("button", { name: /Comenzar/i }))
  await screen.findByText(/Personalizá tu negocio/i)
  fireEvent.click(screen.getByRole("button", { name: /Siguiente/i }))
  await screen.findByRole("heading", { name: /para cargar ahora\?/ })
}

function completeCalls() {
  return callsTo(mockFetch, "POST", "/api/onboarding/complete")
}

describe("OnboardingWizard — question step", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockImplementation(async () => json({}))
  })

  it("Sí completes with camino real and navigates exactly once, to /ordenes?nueva=1", async () => {
    await irAPregunta()

    fireEvent.click(screen.getByRole("button", { name: "Sí, tengo uno" }))

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
    expect(push).toHaveBeenCalledWith("/ordenes?nueva=1")
    expect(completeCalls()).toHaveLength(1)
    expect(bodyOf(completeCalls()[0])).toEqual({ camino: "real" })
  })

  it("still navigates once to /ordenes?nueva=1 when the completion request fails", async () => {
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/onboarding/complete" && init?.method === "POST") throw new TypeError("network down")
      return json({})
    })
    vi.spyOn(console, "error").mockImplementation(() => {})
    await irAPregunta()

    fireEvent.click(screen.getByRole("button", { name: "Sí, tengo uno" }))

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
    expect(push).toHaveBeenCalledWith("/ordenes?nueva=1")
  })

  it("a double tap on Sí sends one completion and one navigation", async () => {
    await irAPregunta()
    const si = screen.getByRole("button", { name: "Sí, tengo uno" })

    fireEvent.click(si)
    fireEvent.click(si)

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
    expect(completeCalls()).toHaveLength(1)
  })

  it("Omitir on the welcome step completes with camino omitido and goes to the dashboard", async () => {
    render(<OnboardingWizard {...wizardProps()} />)

    fireEvent.click(screen.getByRole("button", { name: /Omitir/i }))

    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"))
    expect(push).toHaveBeenCalledTimes(1)
    expect(bodyOf(completeCalls()[0])).toEqual({ camino: "omitido" })
  })

  it("Omitir is still offered on the question step", async () => {
    await irAPregunta()

    fireEvent.click(screen.getByRole("button", { name: /Omitir/i }))

    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"))
    expect(bodyOf(completeCalls()[0])).toEqual({ camino: "omitido" })
  })

  it.each([
    ["Pieza", "¿Tenés una pieza para cargar ahora?", "Sí, tengo una"],
    ["Vehículo", "¿Tenés un vehículo para cargar ahora?", "Sí, tengo uno"],
    ["Máquina de café", "¿Tenés una máquina de café para cargar ahora?", "Sí, tengo una"],
    ["TV", "¿Tenés un TV para cargar ahora?", "Sí, tengo uno"],
  ])("speaks the org's vocabulary (%s)", async (equipo, titulo, boton) => {
    await irAPregunta({ terminologia: resolveTerminologia({ equipo }) })

    expect(screen.getByRole("heading", { name: titulo })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: boton })).toBeInTheDocument()
  })

  it("a double tap on Omitir sends one completion and one navigation", async () => {
    await irAPregunta()
    const omitir = screen.getByRole("button", { name: /Omitir/i })

    fireEvent.click(omitir)
    fireEvent.click(omitir)

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
    expect(completeCalls()).toHaveLength(1)
    expect(bodyOf(completeCalls()[0])).toEqual({ camino: "omitido" })
  })

  it("re-enables Sí and Omitir after the navigation, in case the dashboard sends the user back", async () => {
    await irAPregunta()
    const si = screen.getByRole("button", { name: "Sí, tengo uno" })

    fireEvent.click(si)

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(si).toBeEnabled())
    expect(screen.getByRole("button", { name: /Omitir/i })).toBeEnabled()

    fireEvent.click(screen.getByRole("button", { name: /Omitir/i }))
    await waitFor(() => expect(push).toHaveBeenCalledTimes(2))
    expect(completeCalls()).toHaveLength(2)
  })

  it("offers the practice option when there are no real orders", async () => {
    await irAPregunta()

    expect(screen.getByRole("button", { name: "Todavía no, quiero practicar" })).toBeInTheDocument()
  })

  it("hides the practice option and says why when the shop already has real orders", async () => {
    await irAPregunta({ ordenesRealesCount: 2 })

    expect(screen.queryByRole("button", { name: /quiero practicar/i })).not.toBeInTheDocument()
    expect(screen.getByText(/Ya cargaste órdenes/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Sí, tengo uno" })).toBeInTheDocument()
  })

  it("no longer offers sample data nor a first-client step", async () => {
    await irAPregunta()

    expect(screen.queryByText(/datos de ejemplo/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Tu primer cliente/i)).not.toBeInTheDocument()
    expect(mockFetch.mock.calls.some(([url]) => url === "/api/onboarding/sample-data")).toBe(false)
    expect(mockFetch.mock.calls.some(([url]) => url === "/api/clientes")).toBe(false)
  })

  it("does not steal focus on first mount", () => {
    render(<OnboardingWizard {...wizardProps()} />)

    expect(screen.getByRole("heading", { name: /¡Hola, Ana!/ })).not.toHaveFocus()
  })

  it("moves focus to the new step's title", async () => {
    render(<OnboardingWizard {...wizardProps()} />)

    fireEvent.click(screen.getByRole("button", { name: /Comenzar/i }))

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /Personalizá tu negocio/i })).toHaveFocus()
    )
  })
})
