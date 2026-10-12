import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"

const mockRole = vi.hoisted(() => ({ current: "TECNICO" }))
const mockPush = vi.hoisted(() => vi.fn())
const mockReplace = vi.hoisted(() => vi.fn())

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, refresh: vi.fn() }),
  usePathname: () => "/pos",
}))

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "u1", role: mockRole.current } },
    status: "authenticated",
  }),
}))

import { PosAccessGate } from "@/components/pos/pos-access-gate"

function mockFeatures(res: { ok: boolean; body?: any }) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: res.ok, json: async () => res.body ?? {} }),
  )
}

function renderGate() {
  return render(<PosAccessGate><div>TERMINAL</div></PosAccessGate>)
}

const verTerminal = () => screen.queryByText("TERMINAL")

/**
 * El middleware deja entrar al TECNICO a /pos porque corre en el Edge y no
 * puede leer `tecnicos_operan_pos`. Este gate es quien sí lo lee.
 *
 * La lección de #273 y del gate de inventario: "no pude verificar" NO es "no".
 * Una denegación fabricada por un fetch caído saca de la pantalla a alguien que
 * sí tiene el permiso. Solo un false EXPLÍCITO redirige.
 */
describe("PosAccessGate", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRole.current = "TECNICO"
  })

  it("el ADMIN entra sin preguntar nada al servidor", async () => {
    mockRole.current = "ADMIN"
    mockFeatures({ ok: true, body: { tecnicosOperanPos: false } })

    renderGate()

    expect(verTerminal()).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("el VENDEDOR entra sin preguntar nada al servidor", async () => {
    mockRole.current = "VENDEDOR"
    mockFeatures({ ok: true, body: { tecnicosOperanPos: false } })

    renderGate()

    expect(verTerminal()).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("el técnico habilitado entra", async () => {
    mockFeatures({ ok: true, body: { tecnicosOperanPos: true } })

    renderGate()

    await waitFor(() => expect(verTerminal()).toBeInTheDocument())
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it("el técnico no habilitado no ve la terminal y vuelve al panel", async () => {
    mockFeatures({ ok: true, body: { tecnicosOperanPos: false } })

    renderGate()

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/dashboard"))
    expect(verTerminal()).not.toBeInTheDocument()
  })

  it("no muestra la terminal mientras está verificando", () => {
    mockFeatures({ ok: true, body: { tecnicosOperanPos: true } })

    renderGate()

    expect(verTerminal()).not.toBeInTheDocument()
  })

  it("si el chequeo falla, NO redirige: 'no pude verificar' no es 'no'", async () => {
    mockFeatures({ ok: false })

    renderGate()

    await waitFor(() => expect(verTerminal()).toBeInTheDocument())
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it("si el fetch rechaza, tampoco redirige", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")))

    renderGate()

    await waitFor(() => expect(verTerminal()).toBeInTheDocument())
    expect(mockReplace).not.toHaveBeenCalled()
  })
})
