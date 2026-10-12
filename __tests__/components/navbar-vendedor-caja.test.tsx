import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, waitFor } from "@testing-library/react"

const mockRole = vi.hoisted(() => ({ current: "VENDEDOR" }))

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { name: "Tester", role: mockRole.current, avatar: null } },
    status: "authenticated",
  }),
  signOut: vi.fn(),
}))

vi.mock("@/components/shared/global-search", () => ({ GlobalSearch: () => null }))
vi.mock("@/components/notifications/notification-bell", () => ({ NotificationBell: () => null }))
vi.mock("@/components/ordenes/deadline-calendar", () => ({ DeadlineCalendar: () => null }))
vi.mock("@/components/layout/sucursal-switcher", () => ({ SucursalSwitcher: () => null }))
vi.mock("@/components/billing/plan-badge", () => ({ PlanBadge: () => null }))
vi.mock("@/components/shared/apk-download-banner", () => ({ ApkDownloadBanner: () => null }))
vi.mock("@/components/shared/business-logo", () => ({ BusinessLogo: () => null }))
vi.mock("@/components/shared/user-avatar", () => ({ UserAvatar: () => null }))
vi.mock("@/components/ui/theme-toggle", () => ({ ThemeToggle: () => null }))

import { Navbar } from "@/components/layout/navbar"
import { SidebarProvider } from "@/components/layout/sidebar-context"

function mockFeatures(features: Record<string, boolean>) {
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) =>
    Promise.resolve(
      String(url).startsWith("/api/org/features")
        ? { ok: true, json: async () => features }
        : { ok: false, json: async () => ({}) },
    ),
  ))
}

function hrefs(container: HTMLElement) {
  return Array.from(container.querySelectorAll("a[href]")).map((a) => a.getAttribute("href"))
}

function renderNavbar() {
  return render(<SidebarProvider><Navbar /></SidebarProvider>)
}

/**
 * El navbar es la única puerta visible a la caja: sin el ítem, el permiso está
 * concedido del lado del servidor y el vendedor no se entera.
 */
describe("Navbar — caja para el vendedor habilitado", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRole.current = "VENDEDOR"
  })

  it("con el flag prendido, el vendedor ve Caja", async () => {
    mockFeatures({ vendedoresManejanCaja: true })

    const { container } = renderNavbar()

    await waitFor(() => expect(hrefs(container)).toContain("/caja"))
  })

  it("con el flag apagado, el vendedor no ve Caja", async () => {
    mockFeatures({ vendedoresManejanCaja: false })

    const { container } = renderNavbar()

    // Esperar a que el navbar haya pintado sus ítems antes de afirmar la
    // ausencia: sin esto el assert pasaría por render vacío.
    await waitFor(() => expect(hrefs(container)).toContain("/ordenes"))
    expect(hrefs(container)).not.toContain("/caja")
  })

  it("el ADMIN ve Caja aunque el flag esté apagado", async () => {
    mockRole.current = "ADMIN"
    mockFeatures({ vendedoresManejanCaja: false })

    const { container } = renderNavbar()

    await waitFor(() => expect(hrefs(container)).toContain("/caja"))
  })

  it("el técnico no ve Caja ni con el flag prendido", async () => {
    mockRole.current = "TECNICO"
    mockFeatures({ vendedoresManejanCaja: true, tecnicosOperanPos: true })

    const { container } = renderNavbar()

    await waitFor(() => expect(hrefs(container)).toContain("/ordenes"))
    expect(hrefs(container)).not.toContain("/caja")
  })
})
