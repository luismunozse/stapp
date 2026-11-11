import { describe, it, expect } from "vitest"
import {
  buildPricingFaqs,
  freeOrdersText,
  getFreePlanInfo,
  FREE_PLAN_LIMITS_FALLBACK,
} from "@/lib/plan-copy"
import type { AllPlansPrices } from "@/lib/pricing"

const freePlan = (overrides: Partial<AllPlansPrices["free"]> = {}): AllPlansPrices => ({
  free: {
    id: "f",
    slug: "free",
    nombre: "Free",
    tierOrder: 0,
    ars: { monthly: 0, yearly: 0 },
    usd: { monthly: 0, yearly: 0 },
    limits: { ordenes: 40, tecnicos: 2, clientes: 150, vendedores: 1, storageMb: 1000 },
    featureFlags: { client_portal: true },
    ...overrides,
  },
})

const freeFaq = (faqs: ReturnType<typeof buildPricingFaqs>) =>
  faqs.find((f) => f.question === "¿Qué incluye el plan Free?")!

describe("plan-copy", () => {
  it("usa los límites de la tabla plans cuando están", () => {
    const info = getFreePlanInfo(freePlan())
    expect(freeOrdersText(info.limits)).toBe("Hasta 40 reparaciones por mes")
    const faq = freeFaq(buildPricingFaqs(info))
    expect(faq.answer).toContain(
      "hasta 40 órdenes por mes, 2 técnicos, hasta 150 clientes, 1GB de almacenamiento"
    )
    expect(faq.answer).toContain("portal de seguimiento")
  })

  it("cae a los límites reales del Free (migración 187) si no hay datos", () => {
    const info = getFreePlanInfo(undefined)
    expect(info.limits).toEqual(FREE_PLAN_LIMITS_FALLBACK)
    expect(info.clientPortal).toBe(true)
    expect(freeFaq(buildPricingFaqs(info)).answer).toContain(
      "hasta 30 órdenes por mes, 1 técnico, hasta 200 clientes, 100MB de almacenamiento"
    )
  })

  it("no promete el portal de seguimiento si el flag está apagado", () => {
    const info = getFreePlanInfo(freePlan({ featureFlags: {} }))
    expect(info.clientPortal).toBe(false)
    expect(freeFaq(buildPricingFaqs(info)).answer).not.toContain("seguimiento")
  })

  it("el medio de pago es MercadoPago en pesos, sin promesas en dólares", () => {
    const text = buildPricingFaqs(getFreePlanInfo())
      .map((f) => f.answer)
      .join(" ")
    expect(text).not.toMatch(/USD|internacionales/)
    expect(text).toContain("MercadoPago")
    expect(text).toContain("pesos argentinos")
  })
})
