import { describe, it, expect, vi, beforeEach, type Mock } from "vitest"
import { auth } from "@/lib/auth"
import { wizardProps } from "../components/onboarding-wizard-fixtures"

const redirect = vi.fn((url: string): never => {
  throw new Error(`REDIRECT ${url}`)
})
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }))

const loadProps = vi.fn()
vi.mock("@/app/(dashboard)/onboarding/wizard-props", () => ({
  loadOnboardingWizardProps: (...args: unknown[]) => loadProps(...args),
}))
vi.mock("@/components/onboarding/wizard/onboarding-wizard", () => ({ OnboardingWizard: () => null }))

import OnboardingPage, { dynamic } from "@/app/(dashboard)/onboarding/page"

const authMock = auth as unknown as Mock

function session(role: string) {
  return { user: { id: "user-1", role, organizationId: "org-1", name: "Ana", email: "ana@taller.test" } }
}

describe("/onboarding page", () => {
  beforeEach(() => vi.clearAllMocks())

  it("is never statically cached, so a rubro change re-reads the org", () => {
    expect(dynamic).toBe("force-dynamic")
  })

  it("sends a visitor without session to the login", async () => {
    authMock.mockResolvedValue(null)
    await expect(OnboardingPage()).rejects.toThrow("REDIRECT /login")
  })

  it("sends non-admin roles to the dashboard without loading anything", async () => {
    authMock.mockResolvedValue(session("TECNICO"))
    await expect(OnboardingPage()).rejects.toThrow("REDIRECT /dashboard")
    expect(loadProps).not.toHaveBeenCalled()
  })

  it("feeds the wizard with the props of the loader for an admin", async () => {
    const props = wizardProps({ nombreNegocio: "Taller Ana" })
    authMock.mockResolvedValue(session("ADMIN"))
    loadProps.mockResolvedValue(props)

    const element = await OnboardingPage()

    expect(loadProps).toHaveBeenCalledWith({
      organizationId: "org-1",
      userId: "user-1",
      fallbackNombre: "Ana",
      fallbackEmail: "ana@taller.test",
    })
    expect(element.props).toEqual(props)
  })
})
