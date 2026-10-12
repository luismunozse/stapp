import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, waitFor } from "@testing-library/react"

const mockRole = vi.hoisted(() => ({ current: "TECNICO" }))

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
 * El navbar es la única puerta visible al POS: sin el ítem, el permiso está
 * concedido del lado del servidor y el técnico no se entera.
 */
describe("Navbar — POS para el técnico habilitado", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRole.current = "TECNICO"
  })

  it("con el flag prendido, el técnico ve POS y Ventas", async () => {
    mockFeatures({ tecnicosOperanPos: true })

    const { container } = renderNavbar()

    await waitFor(() => expect(hrefs(container)).toContain("/pos"))
    expect(hrefs(container)).toContain("/ventas")
  })

  it("con el flag apagado, el técnico no ve ni POS ni Ventas", async () => {
    mockFeatures({ tecnicosOperanPos: false })

    const { container } = renderNavbar()

    await waitFor(() => expect(hrefs(container)).toContain("/ordenes"))
    expect(hrefs(container)).not.toContain("/pos")
    expect(hrefs(container)).not.toContain("/ventas")
  })

  it("el flag no le abre al técnico nada que no sea el POS", async () => {
    // El permiso es acotado: vender. No es un ascenso a ADMIN ni a VENDEDOR.
    mockFeatures({ tecnicosOperanPos: true, vendedoresAdministranInventario: true })

    const { container } = renderNavbar()

    await waitFor(() => expect(hrefs(container)).toContain("/pos"))
    for (const prohibido of ["/caja", "/finanzas", "/configuracion", "/inventario", "/reportes"]) {
      expect(hrefs(container)).not.toContain(prohibido)
    }
  })

  it("el vendedor sigue viendo el POS sin depender del flag", async () => {
    mockRole.current = "VENDEDOR"
    mockFeatures({ tecnicosOperanPos: false })

    const { container } = renderNavbar()

    await waitFor(() => expect(hrefs(container)).toContain("/pos"))
  })
})
