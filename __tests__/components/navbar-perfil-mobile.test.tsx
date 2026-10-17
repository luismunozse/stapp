/**
 * Tests: the account entries have to be reachable on a phone.
 *
 * "Mi perfil" and "Tour guiado" only lived in the avatar dropdown of the
 * "Desktop Top-Right Bar" (`hidden lg:flex`), so below `lg` there was no way to
 * reach /perfil, and with it the account-deletion section Google Play requires
 * to be reachable in-app. The drawer footer now exposes them too.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, fireEvent } from "@testing-library/react"

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

describe("Navbar — account entries in the mobile drawer", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }))
  })

  it("links to /perfil from the drawer", () => {
    const { container } = renderNavbar()
    const link = container.querySelector('#mobile-menu-drawer a[href="/perfil"]')

    expect(link).not.toBeNull()
    expect(link!.textContent).toContain("Mi perfil")
  })

  it("closes the drawer when navigating to /perfil", () => {
    const { container } = renderNavbar()
    const drawer = container.querySelector("#mobile-menu-drawer")!
    const toggle = container.querySelector<HTMLElement>('[aria-controls="mobile-menu-drawer"]')!
    fireEvent.click(toggle)
    expect(drawer.className).toContain("translate-x-0")

    fireEvent.click(drawer.querySelector('a[href="/perfil"]')!)

    expect(drawer.className).toContain("translate-x-full")
  })

  it("keeps the manual link in the drawer", () => {
    const { container } = renderNavbar()

    expect(container.querySelector('#mobile-menu-drawer a[href="/ayuda/manual"]')).not.toBeNull()
  })

  it("offers the guided tour and fires start-tour", () => {
    const onTour = vi.fn()
    window.addEventListener("start-tour", onTour)
    const { container } = renderNavbar()
    const drawer = container.querySelector("#mobile-menu-drawer")!
    const btn = Array.from(drawer.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Tour guiado")
    )

    expect(btn).toBeDefined()
    fireEvent.click(btn!)

    expect(onTour).toHaveBeenCalledTimes(1)
    window.removeEventListener("start-tour", onTour)
  })

  it("keeps the logout button in the drawer", () => {
    const { container } = renderNavbar()
    const drawer = container.querySelector("#mobile-menu-drawer")!

    expect(Array.from(drawer.querySelectorAll("button")).some((b) => /Cerrar sesión/i.test(b.textContent ?? ""))).toBe(true)
  })
})
