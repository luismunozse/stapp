/**
 * Con una suscripcion paga y vigente, CurrentPlan solo ofrecia "Cancelar
 * suscripcion": no habia ningun camino en toda la app hacia el selector de modo
 * de cobro, asi que un pagador al dia no podia adherirse al debito automatico.
 * Estos tests fijan a quien se le ofrece la adhesion y a quien no.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { CurrentPlan } from "@/components/billing/current-plan"
import type { SubscriptionInfo } from "@/lib/subscriptions"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ timezone: "America/Argentina/Buenos_Aires" }),
}))

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
  autoDebito: false,
  currentPeriodEnd: "2026-09-19T00:00:00Z",
  trialEnd: null,
  cancelAtPeriodEnd: false,
  limits: {
    ordenes: null,
    tecnicos: null,
    clientes: null,
    vendedores: null,
    storageMb: null,
    sucursales: null,
  },
  features: [],
  featureFlags: {},
}

function renderPlan(
  overrides: Partial<SubscriptionInfo> = {},
  onActivarDebito = vi.fn()
) {
  render(
    <CurrentPlan
      subscription={{ ...BASE, ...overrides }}
      onUpgrade={vi.fn()}
      onManage={vi.fn()}
      onCancel={vi.fn()}
      onActivarDebito={onActivarDebito}
    />
  )
  return onActivarDebito
}

const BOTON = /activar débito automático/i

describe("CurrentPlan — adhesion al debito automatico", () => {
  it("el pagador de MercadoPago sin adhesion puede activarla", () => {
    const onActivarDebito = renderPlan()

    fireEvent.click(screen.getByRole("button", { name: BOTON }))

    expect(onActivarDebito).toHaveBeenCalledTimes(1)
  })

  it("quien ya se adhirio no ve el boton", () => {
    renderPlan({ autoDebito: true })

    expect(screen.queryByRole("button", { name: BOTON })).toBeNull()
  })

  it("quien fue activado a mano desde superadmin tambien puede adherirse", () => {
    // MANUAL no significa "sin medio de pago": la adhesion de MercadoPago pide
    // una tarjeta en su propio link, no reutiliza ninguna. El cajon MANUAL
    // mezcla orgs con el plan regalado y clientes reales reactivados a mano, y
    // a los segundos es justamente a quienes queremos ofrecerles el debito.
    const onActivarDebito = renderPlan({ paymentProvider: "MANUAL" })

    fireEvent.click(screen.getByRole("button", { name: BOTON }))

    expect(onActivarDebito).toHaveBeenCalledTimes(1)
  })

  it("quien paga por Creem no ve el boton: Creem ya cobra solo", () => {
    renderPlan({ paymentProvider: "CREEM" })

    expect(screen.queryByRole("button", { name: BOTON })).toBeNull()
  })

  it("un proveedor viejo como Rebill queda afuera: la lista es cerrada", () => {
    renderPlan({ paymentProvider: "REBILL" })

    expect(screen.queryByRole("button", { name: BOTON })).toBeNull()
  })

  it("quien ya cancelo no ve el boton: no se ofrece adherir algo que se esta yendo", () => {
    renderPlan({ cancelAtPeriodEnd: true })

    expect(screen.queryByRole("button", { name: BOTON })).toBeNull()
  })

  it("el plan Free no ve el boton: primero hay que tener plan pago", () => {
    renderPlan({ planTipo: "FREE", paymentProvider: null })

    expect(screen.queryByRole("button", { name: BOTON })).toBeNull()
  })
})
