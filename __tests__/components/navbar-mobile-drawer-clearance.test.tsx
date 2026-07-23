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

// Child widgets pull in heavy client-only deps that are irrelevant to layout.
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

const renderNavbar = () => render(<SidebarProvider><Navbar /></SidebarProvider>)

/**
 * The mobile bottom-nav is `fixed bottom-0 z-50`, while the mobile menu drawer
 * is `z-40`. Anything the drawer renders inside the bottom-nav band is painted
 * over AND swallowed by it — taps land on the nav, not the drawer.
 *
 * The drawer's footer holds the ONLY logout affordance on mobile, so the drawer
 * must end above the bottom-nav, exactly like it already ends below the header.
 *
 * The clearance token is the same one used by `SidebarMain` and `FormActionBar`:
 * bottom-nav height (h-16 = 4rem) + the safe-area inset it pads itself with.
 */
const BOTTOM_NAV_CLEARANCE = "calc(4rem+env(safe-area-inset-bottom,0px))"

describe("Navbar — mobile drawer vs bottom-nav", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }))
  })

  it("keeps the bottom-nav at the height the clearance token assumes", () => {
    const { container } = renderNavbar()
    const bottomNav = container.querySelector("nav.fixed.bottom-0")
    expect(bottomNav).not.toBeNull()

    // If this height ever changes, BOTTOM_NAV_CLEARANCE must change with it.
    expect(bottomNav!.querySelector(".h-16")).not.toBeNull()
  })

  it("ends the drawer above the bottom-nav so the logout button stays tappable", () => {
    const { container } = renderNavbar()
    const drawer = container.querySelector("#mobile-menu-drawer")
    expect(drawer).not.toBeNull()

    expect(drawer!.className).toContain(`bottom-[${BOTTOM_NAV_CLEARANCE}]`)
    // `bottom-0` would put the footer squarely under the bottom-nav.
    expect(drawer!.className).not.toMatch(/(^|\s)bottom-0(\s|$)/)
  })
})
