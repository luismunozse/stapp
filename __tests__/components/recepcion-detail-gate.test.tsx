/**
 * Gate de plan en la pagina de detalle de un lote (server component).
 *
 * Mismo patron que recepcion-gate.test.tsx (pagina hermana /ordenes/recepcion):
 * hasPlanFeature decide si se muestra el locked view o el detalle real, y sin
 * sesion redirige a /login antes de tocar session.user.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { auth } from "@/lib/auth"
import { hasPlanFeature } from "@/lib/subscriptions"
import { redirect } from "next/navigation"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn(),
}))

// RecepcionDetail depende de fetch + useSession (Task 7 real, ya probado en
// recepcion-detail.test.tsx). Este archivo testea solo el gate de plan de la
// pagina, no el detalle en si.
vi.mock("@/components/ordenes/recepcion-detail", () => ({
  RecepcionDetail: ({ recepcionId }: { recepcionId: string }) => (
    <div data-testid="recepcion-detail">{recepcionId}</div>
  ),
}))

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT")
  }),
}))

import RecepcionDetailPage from "@/app/(dashboard)/ordenes/recepcion/[id]/page"

function mockSession(organizationId = "org-1") {
  vi.mocked(auth).mockResolvedValue({
    user: {
      id: "user-1",
      organizationId,
      role: "ADMIN",
      email: "test@test.com",
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

function createParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe("RecepcionDetailPage — gate de plan", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("sin sesion, redirige a /login", async () => {
    vi.mocked(auth).mockResolvedValue(null as any)

    await RecepcionDetailPage(createParams("rec-1")).catch(() => {})

    expect(redirect).toHaveBeenCalledWith("/login")
  })

  it("con sesion pero sin la feature, muestra el locked view en vez del detalle", async () => {
    mockSession()
    vi.mocked(hasPlanFeature).mockResolvedValue(false)

    const ui = await RecepcionDetailPage(createParams("rec-1"))
    render(ui)

    expect(screen.getByText(/Recepci.n m.ltiple es una funci.n Profesional/i)).toBeInTheDocument()
    expect(redirect).not.toHaveBeenCalled()
  })

  it("con sesion y la feature habilitada, renderiza el detalle con el id de la recepcion", async () => {
    mockSession()
    vi.mocked(hasPlanFeature).mockResolvedValue(true)

    const ui = await RecepcionDetailPage(createParams("rec-1"))
    render(ui)

    expect(screen.queryByText(/es una funci.n Profesional/i)).not.toBeInTheDocument()
    expect(screen.getByTestId("recepcion-detail")).toHaveTextContent("rec-1")
    expect(hasPlanFeature).toHaveBeenCalledWith("org-1", "recepcion_multiple")
  })
})
