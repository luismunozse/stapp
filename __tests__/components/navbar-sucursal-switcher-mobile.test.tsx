/**
 * Tests: the branch switcher has to be reachable on a phone.
 *
 * `SucursalSwitcher` used to be mounted in exactly one place: the "Desktop
 * Top-Right Bar", whose container opens with `hidden lg:flex`. Below the `lg`
 * breakpoint that node never renders, so an ADMIN running the shop from a
 * phone had no way to change the active branch — and no way to tell which one
 * was active, since the label lives on the trigger.
 *
 * The guards inside the component (`isAdmin`, `sucursales.length <= 1`) are
 * breakpoint-agnostic, so this was never about permissions: it was purely
 * about where the node was mounted.
 *
 * The mobile home is the drawer's identity block, next to the name, role and
 * plan badge — the rest of "who you are right now" already lives there.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render } from "@testing-library/react"

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { name: "Tester", role: "ADMIN", avatar: null } },
    status: "authenticated",
  }),
  signOut: vi.fn(),
}))

// Stand-in for the switcher: the real one needs a fetch round-trip and two
// branches before it renders anything, and none of that is what we assert here.
vi.mock("@/components/layout/sucursal-switcher", () => ({
  SucursalSwitcher: ({ variant }: { variant?: string }) => (
    <button data-testid="sucursal-switcher" data-variant={variant ?? "compact"} />
  ),
}))

// Child widgets pull in heavy client-only deps that are irrelevant to layout.
vi.mock("@/components/shared/global-search", () => ({ GlobalSearch: () => null }))
vi.mock("@/components/notifications/notification-bell", () => ({ NotificationBell: () => null }))
vi.mock("@/components/ordenes/deadline-calendar", () => ({ DeadlineCalendar: () => null }))
vi.mock("@/components/billing/plan-badge", () => ({ PlanBadge: () => null }))
vi.mock("@/components/shared/apk-download-banner", () => ({ ApkDownloadBanner: () => null }))
vi.mock("@/components/shared/business-logo", () => ({ BusinessLogo: () => null }))
vi.mock("@/components/shared/user-avatar", () => ({ UserAvatar: () => null }))
vi.mock("@/components/ui/theme-toggle", () => ({ ThemeToggle: () => null }))

import { Navbar } from "@/components/layout/navbar"
import { SidebarProvider } from "@/components/layout/sidebar-context"

const renderNavbar = () => render(<SidebarProvider><Navbar /></SidebarProvider>)

describe("Navbar — branch switcher on mobile", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }))
  })

  it("mounts the switcher inside the mobile drawer", () => {
    const { container } = renderNavbar()
    const drawer = container.querySelector("#mobile-menu-drawer")
    expect(drawer).not.toBeNull()

    expect(drawer!.querySelector('[data-testid="sucursal-switcher"]')).not.toBeNull()
  })

  it("asks for the wide variant there, so the branch name is not truncated to a stub", () => {
    const { container } = renderNavbar()
    const inDrawer = container.querySelector<HTMLElement>(
      '#mobile-menu-drawer [data-testid="sucursal-switcher"]'
    )

    expect(inDrawer!.dataset.variant).toBe("block")
  })

  it("keeps the desktop instance, which is the one hidden below lg", () => {
    const { container } = renderNavbar()
    const all = container.querySelectorAll('[data-testid="sucursal-switcher"]')

    // One for the top-right bar, one for the drawer. Losing either is a regression.
    expect(all).toHaveLength(2)
  })
})
