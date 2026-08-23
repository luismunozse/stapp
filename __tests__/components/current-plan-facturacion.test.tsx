import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { CurrentPlan } from "@/components/billing/current-plan"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ timezone: "America/Argentina/Buenos_Aires" }),
}))

// CurrentPlan exige cuatro props; los tres callbacks no participan de lo que
// se prueba acá, pero sin ellos no compila.
const CALLBACKS = { onUpgrade: () => {}, onManage: () => {}, onCancel: () => {} }

const BASE = {
  id: "sub-1",
  planId: "plan-pro",
  planNombre: "Profesional",
  planTipo: "PREMIUM" as const,
  planSlug: "profesional" as never,
  tierOrder: 2,
  status: "ACTIVE" as const,
  billingPeriod: "MONTHLY" as const,
  paymentProvider: "MERCADOPAGO" as const,
  currentPeriodEnd: "2026-09-19T00:00:00Z",
  trialEnd: null,
  cancelAtPeriodEnd: false,
  limits: { ordenes: null, tecnicos: null, clientes: null, vendedores: null, storageMb: null, sucursales: null },
  features: [],
  featureFlags: {},
}

describe("CurrentPlan — que dice sobre el proximo cobro", () => {
  it("con debito automatico promete que se cobra solo", () => {
    render(<CurrentPlan subscription={{ ...BASE, autoDebito: true }} {...CALLBACKS} />)
    expect(screen.getByText(/Próxima facturación/i)).toBeTruthy()
  })

  it("sin debito automatico NO promete un cobro que no va a pasar", () => {
    render(<CurrentPlan subscription={{ ...BASE, autoDebito: false }} {...CALLBACKS} />)
    expect(screen.queryByText(/Próxima facturación/i)).toBeNull()
    expect(screen.getByText(/Renovás vos/i)).toBeTruthy()
  })
})
