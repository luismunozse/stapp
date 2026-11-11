import { describe, it, expect, vi, beforeEach } from "vitest"

const auth = vi.fn()
const resolveVendedoresVenIngresos = vi.fn()
const hasPlanFeature = vi.fn()
const redirect = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => auth() }))
vi.mock("@/lib/auth-utils", () => ({
  resolveVendedoresVenIngresos: (...a: unknown[]) => resolveVendedoresVenIngresos(...a),
}))
vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: (...a: unknown[]) => hasPlanFeature(...a),
}))
vi.mock("next/navigation", () => ({ redirect: (...a: unknown[]) => redirect(...a) }))
vi.mock("@/components/reportes-avanzados/reportes-avanzados-view", () => ({
  ReportesAvanzadosView: () => null,
}))

import ReportesPage from "@/app/(dashboard)/reportes/page"
import ReportesAvanzadosPage from "@/app/(dashboard)/reportes-avanzados/page"

type Props = { verTopClientes: boolean; reportesAvanzados: boolean }

/** La página devuelve <div><ReportesAvanzadosView .../></div>: se leen las props. */
async function propsDeLaVista(): Promise<Props> {
  const el = (await ReportesPage()) as { props: { children: { props: Props } } }
  return el.props.children.props
}

function sesion(role: string) {
  auth.mockResolvedValue({ user: { role, organizationId: "org-1" } })
}

describe("/reportes — gating del plan", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveVendedoresVenIngresos.mockResolvedValue(true)
  })

  it("en Free baja reportesAvanzados=false (bloqueo por pestaña, no de la página)", async () => {
    sesion("ADMIN")
    hasPlanFeature.mockResolvedValue(false)

    const props = await propsDeLaVista()

    expect(hasPlanFeature).toHaveBeenCalledWith("org-1", "advanced_reports")
    expect(props.reportesAvanzados).toBe(false)
    expect(props.verTopClientes).toBe(true)
  })

  it("en Profesional baja reportesAvanzados=true", async () => {
    sesion("ADMIN")
    hasPlanFeature.mockResolvedValue(true)

    expect((await propsDeLaVista()).reportesAvanzados).toBe(true)
  })

  it("si leer el plan falla, deja pasar: la API decide igual", async () => {
    sesion("ADMIN")
    hasPlanFeature.mockRejectedValue(new Error("db caída"))

    expect((await propsDeLaVista()).reportesAvanzados).toBe(true)
  })

  it("el vendedor sigue resolviendo el permiso de ingresos aparte del plan", async () => {
    sesion("VENDEDOR")
    hasPlanFeature.mockResolvedValue(false)
    resolveVendedoresVenIngresos.mockResolvedValue(false)

    const props = await propsDeLaVista()

    expect(resolveVendedoresVenIngresos).toHaveBeenCalledWith("org-1")
    expect(props).toEqual({ verTopClientes: false, reportesAvanzados: false })
  })
})

describe("/reportes-avanzados", () => {
  it("redirige a /reportes, que ya bloquea por pestaña", () => {
    ReportesAvanzadosPage()
    expect(redirect).toHaveBeenCalledWith("/reportes")
  })
})
