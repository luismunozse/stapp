/**
 * Gate de plan en la pagina de recepcion multiple (server component).
 *
 * Cubre el camino de seguridad que la UI (boton oculto) no puede cubrir por
 * si sola: alguien que entra directo por URL a /ordenes/recepcion no debe
 * llegar al formulario si no hay sesion o si el plan no tiene la feature.
 *
 * Usa hasPlanFeature (no useHasFeature) porque es el unico que aplica los
 * overrides por organizacion de organization_feature_overrides — ver
 * __tests__/api/recepcion-multiple-gate.test.ts para el equivalente del
 * lado de la API.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { auth } from "@/lib/auth"
import { hasPlanFeature } from "@/lib/subscriptions"
import { redirect } from "next/navigation"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn(),
}))

// Este archivo testea el gate de plan de la pagina, no el formulario. El
// formulario real (Task 10) depende de ModalProvider/OfflineProvider/
// CurrencyProvider (los monta el layout de dashboard) y de un canvas 2D real
// para la firma — nada de eso esta presente cuando se renderiza la pagina
// sola, como hace este test. Se mockea para que el gate siga siendo la unica
// responsabilidad de este archivo.
vi.mock("@/components/ordenes/recepcion-form", () => ({
  RecepcionForm: () => <div data-testid="recepcion-form" />,
}))

// El redirect real de next/navigation interrumpe el render lanzando una
// excepcion especial (NEXT_REDIRECT). Replicamos ese throw aca para que el
// componente no siga ejecutando codigo que asume sesion (session.user...)
// despues de llamar a redirect, igual que en produccion.
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT")
  }),
}))

import RecepcionMultiplePage from "@/app/(dashboard)/ordenes/recepcion/page"

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

describe("RecepcionMultiplePage — gate de plan", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("sin sesion, redirige a /login", async () => {
    vi.mocked(auth).mockResolvedValue(null as any)

    // El mock de redirect lanza a proposito (ver arriba); no nos interesa
    // el error en si, solo que redirect haya sido invocado con la ruta
    // correcta antes de que el componente intente usar session.user.
    await RecepcionMultiplePage().catch(() => {})

    expect(redirect).toHaveBeenCalledWith("/login")
  })

  it("con sesion pero sin la feature, muestra el locked view en vez del formulario", async () => {
    mockSession()
    vi.mocked(hasPlanFeature).mockResolvedValue(false)

    const ui = await RecepcionMultiplePage()
    render(ui)

    expect(
      screen.getByText(/Recepci.n de varios equipos es una funci.n Profesional/i)
    ).toBeInTheDocument()
    expect(redirect).not.toHaveBeenCalled()
  })

  it("con sesion y la feature habilitada, no muestra el locked view y consulta la key exacta", async () => {
    mockSession()
    vi.mocked(hasPlanFeature).mockResolvedValue(true)

    const ui = await RecepcionMultiplePage()
    render(ui)

    // RecepcionForm esta mockeado arriba (este archivo testea el gate, no el
    // formulario). Lo verificable aca es que el locked view esta ausente, que
    // el stand-in del formulario se monta en su lugar, y que la feature se
    // consulto con la key exacta — un typo en la key dejaria la funcion
    // abierta para todos silenciosamente.
    expect(screen.queryByText(/es una funci.n Profesional/i)).not.toBeInTheDocument()
    expect(screen.getByTestId("recepcion-form")).toBeInTheDocument()
    expect(hasPlanFeature).toHaveBeenCalledWith("org-1", "recepcion_multiple")
  })
})
