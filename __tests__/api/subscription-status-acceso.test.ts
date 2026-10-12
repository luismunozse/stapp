// @vitest-environment node
/**
 * Acceso a GET /api/subscription/status.
 *
 * Esta ruta estaba cerrada con requireAdmin() sobre el argumento de que "hoy no
 * lo consume nadie en la app". Lo consumen CINCO pantallas del cliente, todas a
 * través del hook `useSubscription`: la lista de cotizaciones, el detalle y las
 * dos listas de clientes, más el badge de plan.
 *
 * El costo de eso no era un 403 visible. `useSubscription` atrapa el error y cae
 * a un fallback "FREE con featureFlags vacío", así que al TECNICO y al VENDEDOR
 * la app les mostraba a su organización como si estuviera en el plan Free: el
 * botón "Nueva Cotización" desaparecía y en su lugar salía el cartel de "las
 * cotizaciones son parte del plan Profesional" — en una organización que estaba
 * pagando Profesional. Un paywall fabricado por un guard, sin un error en
 * pantalla que lo delatara.
 *
 * El plan de la organización no es un dato por rol: es el mismo para todos los
 * que trabajan adentro, y el resto de la app ya lo trata así (/api/org/features
 * es requireAuth por el mismo motivo). Lo que sí es por rol —quién puede
 * escribir qué— lo siguen decidiendo los guards de cada endpoint, no este.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockAuthError, parseResponse } from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  getSubscriptionInfo: vi.fn(),
  isPremium: vi.fn(),
  getTrialInfo: vi.fn(),
}))

import { getSubscriptionInfo, isPremium, getTrialInfo } from "@/lib/subscriptions"

function mockPlanProfesional() {
  vi.mocked(getSubscriptionInfo).mockResolvedValue({
    planTipo: "PREMIUM",
    planNombre: "Profesional",
    planSlug: "profesional",
    tierOrder: 2,
    status: "ACTIVE",
    features: ["cotizaciones_online"],
    featureFlags: { cotizaciones_online: true },
    limits: { ordenes: 500, tecnicos: 10, clientes: 1000, storageMb: 1000 },
  } as any)
  vi.mocked(isPremium).mockResolvedValue(true)
  vi.mocked(getTrialInfo).mockResolvedValue({
    isInTrial: true,
    trialEnd: new Date("2026-09-20T00:00:00.000Z"),
    daysRemaining: 17,
    isPaid: false,
  } as any)
}

describe("/api/subscription/status — acceso por rol", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPlanProfesional()
  })

  it("el TECNICO recibe el plan real de la organización, no un Free fabricado", async () => {
    mockAuthSuccess({ role: "TECNICO", organizationId: "org-1" })

    const { GET } = await import("@/app/api/subscription/status/route")
    const { status, body } = await parseResponse((await GET()) as Response)

    expect(status).toBe(200)
    expect(body.planSlug).toBe("profesional")
    // El flag que decidía si aparecía el botón "Nueva Cotización".
    expect(body.featureFlags.cotizaciones_online).toBe(true)
  })

  it("el VENDEDOR también: el plan de la org no es un dato por rol", async () => {
    mockAuthSuccess({ role: "VENDEDOR", organizationId: "org-1" })

    const { GET } = await import("@/app/api/subscription/status/route")
    const { status, body } = await parseResponse((await GET()) as Response)

    expect(status).toBe(200)
    expect(body.featureFlags.cotizaciones_online).toBe(true)
  })

  it("el ADMIN sigue viendo lo mismo que antes", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })

    const { GET } = await import("@/app/api/subscription/status/route")
    const { status, body } = await parseResponse((await GET()) as Response)

    expect(status).toBe(200)
    expect(body.isPremium).toBe(true)
    expect(body.planNombre).toBe("Profesional")
    expect(body.isInTrial).toBe(true)
    expect(body.daysRemaining).toBe(17)
  })

  it("la lectura sigue atada a la organización de la sesión", async () => {
    mockAuthSuccess({ role: "TECNICO", organizationId: "org-9" })

    const { GET } = await import("@/app/api/subscription/status/route")
    await GET()

    // Abrir la ruta a todos los roles no la abre a otras organizaciones: el id
    // sale de la sesión y nunca del request.
    expect(vi.mocked(getSubscriptionInfo)).toHaveBeenCalledWith("org-9")
    expect(vi.mocked(isPremium)).toHaveBeenCalledWith("org-9")
    expect(vi.mocked(getTrialInfo)).toHaveBeenCalledWith("org-9")
  })

  it("sin sesión sigue siendo 401", async () => {
    mockAuthError()

    const { GET } = await import("@/app/api/subscription/status/route")
    const { status } = await parseResponse((await GET()) as Response)

    expect(status).toBe(401)
    expect(vi.mocked(getSubscriptionInfo)).not.toHaveBeenCalled()
  })
})
