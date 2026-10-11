/**
 * "Crear mi primera orden" completed onboarding (which pushed /dashboard) and
 * then pushed /ordenes?new=true: two competing navigations, and a param nobody
 * reads. It must complete onboarding and navigate once to /ordenes?nueva=1.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

const push = vi.fn()
const refresh = vi.fn()
const router = { push, refresh }
vi.mock("next/navigation", () => ({ useRouter: () => router }))

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

function json(body: unknown, ok = true) {
  return { ok, json: async () => body }
}

describe("OnboardingWizard — crear mi primera orden", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockImplementation(async () => json({}))
  })

  it("completes onboarding and navigates exactly once, to /ordenes?nueva=1", async () => {
    const { OnboardingWizard } = await import("@/components/onboarding/onboarding-wizard")
    render(<OnboardingWizard />)
    fireEvent.click(screen.getByRole("button", { name: /Comenzar configuración/i }))
    await screen.findByText(/Personalizá tu negocio/i)
    fireEvent.click(screen.getByRole("button", { name: /Siguiente/i }))
    await screen.findByText("Tu primer cliente")
    fireEvent.click(screen.getByRole("button", { name: /Omitir/i }))
    await screen.findByText("Tu primera orden")

    fireEvent.click(screen.getByRole("button", { name: /Crear mi primera orden/i }))

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
    expect(push).toHaveBeenCalledWith("/ordenes?nueva=1")
    expect(push).not.toHaveBeenCalledWith("/dashboard")
    expect(
      mockFetch.mock.calls.filter(
        ([url, init]) => url === "/api/onboarding/complete" && init?.method === "POST"
      )
    ).toHaveLength(1)
  })

  it("still navigates once to /ordenes?nueva=1 when the completion request fails", async () => {
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/onboarding/complete" && init?.method === "POST") {
        throw new TypeError("network down")
      }
      return json({})
    })
    vi.spyOn(console, "error").mockImplementation(() => {})
    const { OnboardingWizard } = await import("@/components/onboarding/onboarding-wizard")
    render(<OnboardingWizard />)
    fireEvent.click(screen.getByRole("button", { name: /Comenzar configuración/i }))
    await screen.findByText(/Personalizá tu negocio/i)
    fireEvent.click(screen.getByRole("button", { name: /Siguiente/i }))
    await screen.findByText("Tu primer cliente")
    fireEvent.click(screen.getByRole("button", { name: /Omitir/i }))
    await screen.findByText("Tu primera orden")

    fireEvent.click(screen.getByRole("button", { name: /Crear mi primera orden/i }))

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
    expect(push).toHaveBeenCalledWith("/ordenes?nueva=1")
  })

  it("keeps sending skip to the dashboard", async () => {
    const { OnboardingWizard } = await import("@/components/onboarding/onboarding-wizard")
    render(<OnboardingWizard />)

    fireEvent.click(screen.getByRole("button", { name: /Omitir e ir al dashboard/i }))

    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"))
    expect(push).toHaveBeenCalledTimes(1)
  })
})
