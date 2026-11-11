import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, waitFor } from "@testing-library/react"
import { redirigirPorRol } from "@/lib/rutas-por-rol"

const mockRole = vi.hoisted(() => ({ current: "ADMIN" }))

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { name: "Tester", role: mockRole.current, avatar: null } }, status: "authenticated" }),
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
import { tourSteps } from "@/lib/tour-config"

const hrefs = (c: HTMLElement) => Array.from(c.querySelectorAll("a[href]")).map((a) => a.getAttribute("href"))

describe("Navbar — Garantías", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })))
  })

  it.each(["ADMIN", "VENDEDOR", "TECNICO"])("%s ve la entrada a /garantias", async (role) => {
    mockRole.current = role
    const { container } = render(<SidebarProvider><Navbar /></SidebarProvider>)
    await waitFor(() => expect(hrefs(container)).toContain("/garantias"))
  })

  it("el middleware no rebota a ningún rol de /garantias", () => {
    for (const role of ["ADMIN", "VENDEDOR", "TECNICO"]) {
      expect(redirigirPorRol("/garantias", role)).toBe(false)
    }
  })

  it("el tour la presenta con el id que la navbar le da (nav-<ruta>)", () => {
    expect(tourSteps.map((s) => s.element)).toContain("#nav-garantias")
  })
})
