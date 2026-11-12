import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"

const push = vi.hoisted(() => vi.fn())
const mockRole = vi.hoisted(() => ({ current: "ADMIN" }))

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { name: "Tester", role: mockRole.current, avatar: null } },
    status: "authenticated",
  }),
  signOut: vi.fn(),
}))

vi.mock("@/components/notifications/notification-bell", () => ({ NotificationBell: () => null }))
vi.mock("@/components/ordenes/deadline-calendar", () => ({ DeadlineCalendar: () => null }))
vi.mock("@/components/layout/sucursal-switcher", () => ({ SucursalSwitcher: () => null }))
vi.mock("@/components/billing/plan-badge", () => ({ PlanBadge: () => null }))
vi.mock("@/components/shared/apk-download-banner", () => ({ ApkDownloadBanner: () => null }))
vi.mock("@/components/shared/business-logo", () => ({ BusinessLogo: () => null }))
vi.mock("@/components/shared/user-avatar", () => ({ UserAvatar: () => null }))
vi.mock("@/components/ui/theme-toggle", () => ({ ThemeToggle: () => null }))
vi.mock("@/components/asistente/asistente-nav-button", () => ({ AsistenteNavButton: () => null }))

import { Navbar } from "@/components/layout/navbar"
import { SidebarProvider } from "@/components/layout/sidebar-context"
import { GlobalSearch } from "@/components/shared/global-search"
import { ORG_FEATURES_APAGADAS, accionesVisibles, itemsVisibles } from "@/lib/navegacion"

function mockFetch(search: unknown = { clientes: [], ordenes: [] }) {
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
    const u = String(url)
    if (u.startsWith("/api/search")) return Promise.resolve({ ok: true, json: async () => search })
    if (u.startsWith("/api/org/features")) return Promise.resolve({ ok: true, json: async () => ({}) })
    return Promise.resolve({ ok: false, json: async () => ({}) })
  }))
}

function pressCtrlK(target: EventTarget = window) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }))
  })
}

function renderPaleta(role: string) {
  return render(
    <GlobalSearch navItems={itemsVisibles(role, ORG_FEATURES_APAGADAS)} acciones={accionesVisibles(role, ORG_FEATURES_APAGADAS)} />,
  )
}

describe("Navbar — Mi plan en el menú de la cuenta", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch()
  })

  it("el ADMIN lo tiene en el menú mobile y no hay 'Facturación' en la navegación", () => {
    mockRole.current = "ADMIN"
    const { container } = render(<SidebarProvider><Navbar /></SidebarProvider>)

    const link = container.querySelector('#mobile-menu-drawer a[href="/configuracion/billing"]')
    expect(link?.textContent).toContain("Mi plan")
    const textos = Array.from(container.querySelectorAll("nav a")).map((a) => a.textContent)
    expect(textos).not.toContain("Facturación")
    expect(textos).not.toContain("Dashboard")
  })

  it("el técnico no lo ve (la suscripción es del ADMIN)", () => {
    mockRole.current = "TECNICO"
    const { container } = render(<SidebarProvider><Navbar /></SidebarProvider>)

    expect(container.querySelector('a[href="/configuracion/billing"]')).toBeNull()
  })
})

describe("Paleta de comandos", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRole.current = "ADMIN"
    mockFetch()
  })

  it("el Navbar la monta una sola vez aunque haya dos disparadores", async () => {
    render(<SidebarProvider><Navbar /></SidebarProvider>)

    expect(screen.getAllByRole("button", { name: /buscar o ir a/i })).toHaveLength(2)
    pressCtrlK()
    await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(1))
    expect(screen.getAllByRole("combobox", { name: "Buscar o ir a" })).toHaveLength(1)
  })

  it("los disparadores la abren", async () => {
    render(<SidebarProvider><Navbar /></SidebarProvider>)

    fireEvent.click(screen.getAllByRole("button", { name: /buscar o ir a/i })[0])
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument())
  })

  it("muestra 'Acciones' e 'Ir a…' filtrados por rol (TECNICO sin POS)", async () => {
    renderPaleta("TECNICO")
    pressCtrlK()

    const acciones = await screen.findByRole("group", { name: "Acciones" })
    expect(acciones.textContent).toContain("Nueva orden")
    expect(acciones.textContent).not.toContain("Nueva venta")
    const irA = screen.getByRole("group", { name: "Ir a…" })
    expect(irA.textContent).toContain("Órdenes")
    expect(irA.textContent).not.toContain("Caja")
    expect(irA.textContent).not.toContain("Configuración")
  })

  it("ADMIN ve Configuración y Nueva orden de compra", async () => {
    renderPaleta("ADMIN")
    pressCtrlK()

    expect((await screen.findByRole("group", { name: "Acciones" })).textContent).toContain("Nueva orden de compra")
    expect(screen.getByRole("group", { name: "Ir a…" }).textContent).toContain("Configuración")
  })

  it("filtra secciones y acciones mientras se escribe", async () => {
    renderPaleta("ADMIN")
    pressCtrlK()

    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "caja" } })
    const irA = screen.getByRole("group", { name: "Ir a…" })
    expect(irA.textContent).toContain("Caja")
    expect(irA.textContent).not.toContain("Órdenes")
  })

  it("un cliente encontrado lleva a su ficha, no al listado", async () => {
    mockFetch({
      clientes: [{ id: "cli-1", nombre: "Diego Alanis", telefono: "351", email: null, dni: null }],
      ordenes: [],
    })
    renderPaleta("ADMIN")
    pressCtrlK()

    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "diego" } })
    const opcion = await screen.findByRole("option", { name: /Diego Alanis/ }, { timeout: 2000 })
    fireEvent.click(opcion)

    expect(push).toHaveBeenCalledWith("/clientes/cli-1")
  })

  it("Enter abre la opción marcada", async () => {
    renderPaleta("ADMIN")
    pressCtrlK()

    const input = await screen.findByRole("combobox")
    fireEvent.change(input, { target: { value: "nuevo cliente" } })
    fireEvent.keyDown(input, { key: "Enter" })

    expect(push).toHaveBeenCalledWith("/clientes?nuevo=1")
  })
})
