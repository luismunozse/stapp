import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"

const hasFeatureMock = vi.fn()
vi.mock("@/hooks/use-subscription", () => ({
  useHasFeature: () => hasFeatureMock(),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,xx") } }))
vi.mock("@/components/catalogo/catalogo-stats-card", () => ({ CatalogoStatsCard: () => null }))

import { CatalogoCompartirTab } from "@/components/catalogo/catalogo-compartir-tab"

describe("CatalogoCompartirTab — aviso de plan sin pedidos online", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          url: "https://x.test/catalogo/t",
          config: { slug: "t", titulo: "T", descripcion: null, color_primary: "#111111", whatsapp: null, banner_url: null, activo: true, trust_badges: [] },
        }),
      })
    )
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("avisa que los pedidos llegan solo por WhatsApp cuando el plan no tiene cotizaciones_online", async () => {
    hasFeatureMock.mockReturnValue({ hasFeature: false, loading: false })
    render(<CatalogoCompartirTab />)
    expect(await screen.findByText(/solo por WhatsApp/i)).toBeInTheDocument()
    expect(screen.getByText(/no se registran/i)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /plan/i })).toHaveAttribute("href", expect.stringContaining("/configuracion/billing"))
  })

  it("no muestra el aviso en un plan con pedidos online ni mientras carga el plan", async () => {
    hasFeatureMock.mockReturnValue({ hasFeature: true, loading: false })
    const { unmount } = render(<CatalogoCompartirTab />)
    await screen.findByText(/Catálogo público activo/i)
    expect(screen.queryByText(/solo por WhatsApp/i)).toBeNull()
    unmount()
    hasFeatureMock.mockReturnValue({ hasFeature: false, loading: true })
    render(<CatalogoCompartirTab />)
    await screen.findByText(/Catálogo público activo/i)
    expect(screen.queryByText(/solo por WhatsApp/i)).toBeNull()
  })
})
