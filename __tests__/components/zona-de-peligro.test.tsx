import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { ZonaDePeligro } from "@/components/perfil/zona-de-peligro"
import type { DeletionInfo } from "@/lib/account-deletion/types"

const sessionUser: { isSuperadmin?: boolean; isImpersonating?: boolean } = {}
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: sessionUser } }),
}))

const info = (over: Partial<DeletionInfo> = {}): DeletionInfo => ({
  role: "TECNICO", slug: "taller-uno", orgName: "Taller Uno",
  isLastAdmin: false, hasPassword: true, totpEnabled: false, graceDays: 30, ...over,
})

function mockInfo(i: DeletionInfo) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(i), { status: 200 })))
}

describe("ZonaDePeligro", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete sessionUser.isSuperadmin
    delete sessionUser.isImpersonating
    window.location.hash = ""
  })

  it("un técnico solo puede eliminar su usuario", async () => {
    mockInfo(info())
    render(<ZonaDePeligro />)
    expect(await screen.findByRole("button", { name: /eliminar mi usuario/i })).toBeEnabled()
    expect(screen.queryByRole("button", { name: /eliminar el taller/i })).toBeNull()
  })

  it("un administrador puede eliminar su usuario y el taller", async () => {
    mockInfo(info({ role: "ADMIN" }))
    render(<ZonaDePeligro />)
    expect(await screen.findByRole("button", { name: /eliminar el taller/i })).toBeEnabled()
    expect(screen.getByRole("button", { name: /eliminar mi usuario/i })).toBeEnabled()
  })

  it("el último administrador no puede eliminar solo su usuario: ve el motivo y el camino alternativo", async () => {
    mockInfo(info({ role: "ADMIN", isLastAdmin: true }))
    render(<ZonaDePeligro />)
    expect(await screen.findByRole("button", { name: /eliminar mi usuario/i })).toBeDisabled()
    expect(screen.getByText(/único administrador/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /eliminar el taller/i })).toBeEnabled()
    expect(screen.getByRole("button", { name: /ir a la opción de borrar el taller/i })).toBeEnabled()
  })

  it("si no se puede cargar la información no ofrece ninguna acción destructiva", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })))
    render(<ZonaDePeligro />)
    await waitFor(() => expect(screen.getByText(/no pudimos cargar las opciones de eliminación/i)).toBeInTheDocument())
    expect(screen.queryByRole("button", { name: /eliminar/i })).toBeNull()
  })

  it("una respuesta no JSON tampoco rompe la sección", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>", { status: 200 })))
    render(<ZonaDePeligro />)
    await waitFor(() => expect(screen.getByText(/no pudimos cargar/i)).toBeInTheDocument())
  })

  it("el ancla #eliminar existe desde el primer render, antes de cargar", () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})))
    const { container } = render(<ZonaDePeligro />)
    expect(container.querySelector("#eliminar")).not.toBeNull()
    expect(screen.queryByRole("button", { name: /eliminar/i })).toBeNull()
  })

  it("no se muestra para superadmin ni sesiones impersonadas", () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    sessionUser.isImpersonating = true
    const { container } = render(<ZonaDePeligro />)
    expect(container.querySelector("#eliminar")).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
