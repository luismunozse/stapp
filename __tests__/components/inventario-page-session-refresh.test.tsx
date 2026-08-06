import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"

// La página de inventario se desmontaba entera cuando useSession pasaba a
// "loading" durante un refresco de sesión (que dispara el foco de la ventana).
// Eso destruía el modal de importación y el archivo ya elegido.

let sessionState: { data: unknown; status: string } = {
  data: { user: { role: "ADMIN" } },
  status: "authenticated",
}

vi.mock("next-auth/react", () => ({
  useSession: () => sessionState,
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
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

describe("InventarioPage durante un refresco de sesión", () => {
  beforeEach(() => {
    sessionState = { data: { user: { role: "ADMIN" } }, status: "authenticated" }
  })

  it("mantiene la lista montada cuando la sesión se está refrescando", () => {
    const { rerender } = render(<InventarioPage />)
    expect(screen.getByTestId("lista")).toBeInTheDocument()

    // update() de next-auth deja status en "loading" mientras revalida.
    sessionState = { data: { user: { role: "ADMIN" } }, status: "loading" }
    rerender(<InventarioPage />)

    expect(screen.queryByTestId("lista")).toBeInTheDocument()
  })

  it("no renderiza nada en la carga inicial, antes de conocer la sesión", () => {
    sessionState = { data: null, status: "loading" }
    const { container } = render(<InventarioPage />)
    expect(container).toBeEmptyDOMElement()
  })
})
