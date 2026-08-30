import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"

const mockRole = vi.hoisted(() => ({ current: "VENDEDOR" }))
const mockReplace = vi.hoisted(() => vi.fn())

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/caja",
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { name: "Tester", role: mockRole.current } },
    status: "authenticated",
  }),
}))

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ timezone: "America/Argentina/Buenos_Aires", currency: "ARS" }),
}))

// Stubs identificables: lo que se testea es QUIÉN los ve, no qué dibujan.
vi.mock("@/components/caja/caja-session-banner", () => ({
  CajaSessionBanner: () => <div data-testid="session-banner" />,
}))
vi.mock("@/components/caja/apertura-dialog", () => ({ AperturaDialog: () => null }))
vi.mock("@/components/caja/cierre-dialog", () => ({ CierreDialog: () => null }))
vi.mock("@/components/caja/caja-resumen", () => ({
  CajaResumen: () => <div data-testid="resumen" />,
}))
vi.mock("@/components/caja/movimiento-manual-form", () => ({
  MovimientoManualForm: () => <div data-testid="mov-form" />,
}))
vi.mock("@/components/caja/movimientos-manuales-list", () => ({
  MovimientosManualesList: () => null,
}))
vi.mock("@/components/caja/historial-cierres", () => ({
  HistorialCierres: () => <div data-testid="historial" />,
}))
vi.mock("@/components/caja/export-button", () => ({
  ExportButton: () => <button data-testid="export">Exportar</button>,
}))

import CajaPage from "@/app/(dashboard)/caja/page"

function mockApis(features: Record<string, boolean>) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      const u = String(url)
      if (u.startsWith("/api/org/features")) {
        return Promise.resolve({ ok: true, json: async () => features })
      }
      if (u.startsWith("/api/caja")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ sesionActual: null, totales: {}, movimientos: [] }),
        })
      }
      return Promise.resolve({ ok: false, json: async () => ({}) })
    }),
  )
}

/**
 * La pantalla de caja escondía TODA la operativa detrás de `isAdmin`. Con el
 * permiso concedido del lado del servidor, un vendedor habilitado seguiría sin
 * ver el botón de abrir la caja: el permiso existiría solo en la base.
 *
 * El corte no es "el vendedor ve todo": el histórico financiero —export CSV e
 * historial de cierres— sigue siendo del ADMIN.
 */
describe("Pantalla de caja — vendedor habilitado", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRole.current = "VENDEDOR"
  })

  it("con el flag prendido ve la apertura/cierre y los movimientos manuales", async () => {
    mockApis({ vendedoresManejanCaja: true })

    render(<CajaPage />)

    await waitFor(() => expect(screen.getByTestId("session-banner")).toBeTruthy())
    expect(screen.getByText("Movimientos Manuales")).toBeTruthy()
  })

  it("con el flag prendido NO ve el histórico financiero", async () => {
    mockApis({ vendedoresManejanCaja: true })

    render(<CajaPage />)

    await waitFor(() => expect(screen.getByTestId("session-banner")).toBeTruthy())
    expect(screen.queryByText("Historial de Cierres")).toBeNull()
    expect(screen.queryByTestId("export")).toBeNull()
  })

  it("con el flag apagado no ve nada de la operativa", async () => {
    mockApis({ vendedoresManejanCaja: false })

    render(<CajaPage />)

    await waitFor(() => expect(screen.getByTestId("resumen")).toBeTruthy())
    expect(screen.queryByTestId("session-banner")).toBeNull()
    expect(screen.queryByText("Movimientos Manuales")).toBeNull()
  })

  it("si el permiso no se puede leer queda afuera: fail-closed", async () => {
    // Un 503 de /api/org/features no es "el permiso está apagado", pero acá
    // la respuesta segura es la misma: no dibujar controles que el servidor
    // va a rechazar con 403.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        const u = String(url)
        if (u.startsWith("/api/org/features")) {
          return Promise.resolve({ ok: false, json: async () => ({}) })
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ sesionActual: null, totales: {}, movimientos: [] }),
        })
      }),
    )

    render(<CajaPage />)

    await waitFor(() => expect(screen.getByTestId("resumen")).toBeTruthy())
    expect(screen.queryByTestId("session-banner")).toBeNull()
  })

  it("el ADMIN sigue viendo todo, flag apagado incluido", async () => {
    mockRole.current = "ADMIN"
    mockApis({ vendedoresManejanCaja: false })

    render(<CajaPage />)

    await waitFor(() => expect(screen.getByTestId("session-banner")).toBeTruthy())
    expect(screen.getByText("Movimientos Manuales")).toBeTruthy()
    expect(screen.getByText("Historial de Cierres")).toBeTruthy()
    expect(screen.getByTestId("export")).toBeTruthy()
  })

  it("con el flag apagado lo saca de la pantalla", async () => {
    // Desde que /api/caja pide requireCajaAccess, un vendedor sin el permiso
    // que llegue por URL solo veria "Error al cargar datos". El middleware lo
    // deja entrar a proposito —en el Edge no se puede leer el flag—, asi que
    // el rebote es de esta pantalla.
    mockApis({ vendedoresManejanCaja: false })

    render(<CajaPage />)

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/dashboard"))
  })

  it("si el permiso no se pudo verificar NO lo expulsa", async () => {
    // Un 503 no es una negativa. Expulsar ahi es una denegacion fabricada:
    // saca de la pantalla a alguien que si tiene el permiso. No abre nada,
    // porque toda lectura y escritura sigue siendo fail-closed en el server.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) =>
        String(url).startsWith("/api/org/features")
          ? Promise.resolve({ ok: false, json: async () => ({}) })
          : Promise.resolve({
              ok: true,
              json: async () => ({ sesionActual: null, totales: {}, movimientos: [] }),
            }),
      ),
    )

    render(<CajaPage />)

    await waitFor(() => expect(screen.getByTestId("resumen")).toBeTruthy())
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it("al ADMIN no lo toca ni le cuesta un fetch de permisos", async () => {
    mockRole.current = "ADMIN"
    mockApis({ vendedoresManejanCaja: false })

    render(<CajaPage />)

    await waitFor(() => expect(screen.getByTestId("session-banner")).toBeTruthy())
    expect(mockReplace).not.toHaveBeenCalled()
    const urls = (globalThis.fetch as any).mock.calls.map((c: any[]) => String(c[0]))
    expect(urls.some((u: string) => u.startsWith("/api/org/features"))).toBe(false)
  })
})
