import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react"

vi.mock("@/hooks/use-subscription", () => ({
  useHasFeature: () => ({ hasFeature: true, loading: false }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,xx") } }))
vi.mock("@/components/catalogo/catalogo-stats-card", () => ({ CatalogoStatsCard: () => null }))
import { toast } from "sonner"

import { CatalogoCompartirTab } from "@/components/catalogo/catalogo-compartir-tab"

const baseConfig = { slug: "t", titulo: "T", descripcion: null, color_primary: "#111111", whatsapp: null, banner_url: null, activo: true, trust_badges: [] }

function stubFetch(config: Record<string, unknown>) {
  const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => ({
    ok: true,
    json: async () => ({ url: "https://x.test/catalogo/t", config: init?.method === "PUT" ? { ...config, ...JSON.parse(String(init.body)) } : config }),
  }))
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

const putBody = (f: ReturnType<typeof vi.fn>) => {
  const call = f.mock.calls.find((c) => c[1]?.method === "PUT")
  return call ? JSON.parse(String(call[1].body)) : null
}

describe("CatalogoCompartirTab — reserva de stock (horas)", () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("shows the saved value and a helper text about releasing reserved stock", async () => {
    stubFetch({ ...baseConfig, reserva_horas: 72 })
    render(<CatalogoCompartirTab />)
    const input = (await screen.findByLabelText(/reserva de stock \(horas\)/i)) as HTMLInputElement
    expect(input.value).toBe("72")
    expect(screen.getByText(/liberan el stock reservado/i)).toBeInTheDocument()
  })

  it("sends reserva_horas as an integer when saving", async () => {
    const f = stubFetch({ ...baseConfig, reserva_horas: 48 })
    render(<CatalogoCompartirTab />)
    const input = await screen.findByLabelText(/reserva de stock \(horas\)/i)
    fireEvent.change(input, { target: { value: "24" } })
    fireEvent.click(screen.getByRole("button", { name: /guardar/i }))
    await waitFor(() => expect(putBody(f)).not.toBeNull())
    expect(putBody(f).reserva_horas).toBe(24)
  })

  it("blocks values outside 1-720 without calling the API", async () => {
    const f = stubFetch({ ...baseConfig, reserva_horas: 48 })
    render(<CatalogoCompartirTab />)
    const input = await screen.findByLabelText(/reserva de stock \(horas\)/i)
    fireEvent.change(input, { target: { value: "1000" } })
    fireEvent.click(screen.getByRole("button", { name: /guardar/i }))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(putBody(f)).toBeNull()
  })

  it("does not send reserva_horas when the column does not exist yet (migration 337 pending)", async () => {
    const f = stubFetch({ ...baseConfig })
    render(<CatalogoCompartirTab />)
    await screen.findByLabelText(/reserva de stock \(horas\)/i)
    fireEvent.click(screen.getByRole("button", { name: /guardar/i }))
    await waitFor(() => expect(putBody(f)).not.toBeNull())
    expect(putBody(f)).not.toHaveProperty("reserva_horas")
  })
})
