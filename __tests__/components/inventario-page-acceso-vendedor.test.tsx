import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"

/**
 * The inventory page runs an org-level permission check for VENDEDOR
 * (/api/org/features) and used to navigate away on ANY failure of it, from an
 * effect that depended on the session OBJECT -- which NextAuth replaces on
 * every refresh. Put together, one flaky request during a routine session
 * refresh yanked an operator off the screen mid-form, and everything typed
 * into the inventory dialog went with it. Inventory has no draft persistence,
 * so there is nothing to recover from.
 *
 * Same class as the bug fixed for the "loading" blank (see
 * inventario-page-session-refresh.test.tsx), different trigger.
 *
 * Two properties are pinned here:
 *
 *  1. The check re-runs only when the user or the role actually changes, not
 *     every time a new session object arrives.
 *  2. Only an explicit DENIAL navigates. A check that could not be completed
 *     leaves the operator where they are -- the real gate is server-side
 *     (requireInventarioAccess on every mutating inventory endpoint), so a user
 *     who truly lacks access gets 403s from the API instead of losing work.
 */

const { routerMock } = vi.hoisted(() => ({
  routerMock: { replace: vi.fn(), push: vi.fn() },
}))
const replaceMock = routerMock.replace

let sessionState: { data: unknown; status: string } = {
  data: { user: { id: "u1", role: "VENDEDOR" } },
  status: "authenticated",
}

vi.mock("next-auth/react", () => ({
  useSession: () => sessionState,
}))

// Next's App Router hands back the SAME router object across renders (it is a
// context value). The mock has to mirror that: a fresh object per render makes
// every effect that lists `router` re-run on every commit, which would have the
// test passing or failing on its own instability instead of on the component's.
vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}))

vi.mock("@/components/inventario/inventario-list", () => ({
  InventarioList: () => <div data-testid="lista">lista</div>,
}))

vi.mock("@/components/inventario/inventario-analytics", () => ({
  InventarioAnalytics: () => null,
}))

vi.mock("@/components/ui/page-shell", () => ({
  PageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

import InventarioPage from "@/app/(dashboard)/inventario/page"

function sesionVendedor(id = "u1") {
  return { data: { user: { id, role: "VENDEDOR" } }, status: "authenticated" }
}

describe("InventarioPage — chequeo de acceso del VENDEDOR", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    sessionState = sesionVendedor()
    fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({ vendedoresAdministranInventario: true }),
      } as Response),
    )
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("no vuelve a chequear cuando NextAuth entrega un objeto de sesión nuevo con el mismo usuario", async () => {
    const { rerender } = render(<InventarioPage />)
    await waitFor(() => expect(screen.getByTestId("lista")).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Un refresco de sesión: mismo usuario, mismo rol, objeto distinto.
    sessionState = sesionVendedor()
    rerender(<InventarioPage />)
    rerender(<InventarioPage />)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it("vuelve a chequear cuando cambia el usuario de la sesión", async () => {
    const { rerender } = render(<InventarioPage />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    sessionState = sesionVendedor("u2")
    rerender(<InventarioPage />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it("deja al operador en la pantalla cuando el chequeo falla por red", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError("Failed to fetch")))

    render(<InventarioPage />)

    await waitFor(() => expect(screen.getByTestId("lista")).toBeInTheDocument())
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it("avisa que no pudo verificar el permiso, sin bloquear la pantalla", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError("Failed to fetch")))

    render(<InventarioPage />)

    await waitFor(() => expect(screen.getByText(/no se pudo verificar/i)).toBeInTheDocument())
    expect(screen.getByTestId("lista")).toBeInTheDocument()
  })

  it("tampoco navega cuando la API contesta con un error HTTP", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({ ok: false, status: 500, json: async () => ({}) } as Response),
    )

    render(<InventarioPage />)

    await waitFor(() => expect(screen.getByTestId("lista")).toBeInTheDocument())
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it("reintenta el chequeo desde el aviso y se recupera solo", async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new TypeError("Failed to fetch")))

    render(<InventarioPage />)
    const reintentar = await screen.findByRole("button", { name: /reintentar/i })

    fireEvent.click(reintentar)

    await waitFor(() => expect(screen.queryByText(/no se pudo verificar/i)).not.toBeInTheDocument())
    expect(screen.getByTestId("lista")).toBeInTheDocument()
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it("sigue sacando de la pantalla al vendedor cuando la organización le niega el acceso", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({ vendedoresAdministranInventario: false }),
      } as Response),
    )

    render(<InventarioPage />)

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/dashboard"))
    expect(screen.queryByTestId("lista")).not.toBeInTheDocument()
  })

  it("no chequea nada para un ADMIN", async () => {
    sessionState = { data: { user: { id: "a1", role: "ADMIN" } }, status: "authenticated" }

    render(<InventarioPage />)

    expect(screen.getByTestId("lista")).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(replaceMock).not.toHaveBeenCalled()
  })
})
