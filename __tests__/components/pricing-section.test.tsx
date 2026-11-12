import { describe, it, expect, vi, beforeAll } from "vitest"
import { render, screen } from "@testing-library/react"
import { PricingSection } from "@/components/landing/pricing-section"
import type { PlanPrices } from "@/lib/pricing"

vi.mock("next/image", () => ({
  default: (props: { alt: string }) => <span>{props.alt}</span>,
}))

beforeAll(() => {
  // framer-motion (whileInView) necesita IntersectionObserver en jsdom
  class IO {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  }
  vi.stubGlobal("IntersectionObserver", IO)
})

const prices: PlanPrices = {
  ars: { monthly: 19999, yearly: 149999 },
  usd: { monthly: 14, yearly: 107 },
}

describe("PricingSection", () => {
  it("muestra solo precios en ARS, sin USD", () => {
    const { container } = render(<PricingSection prices={prices} />)
    expect(screen.getByText("$19.999")).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/USD/)
  })

  it("sin datos de DB usa el límite real del Free (30/mes)", () => {
    render(<PricingSection prices={prices} />)
    expect(screen.getByText("Hasta 30 reparaciones por mes")).toBeInTheDocument()
  })

  it("toma el límite de reparaciones del Free desde los planes de la DB", () => {
    render(
      <PricingSection
        prices={prices}
        allPlans={{
          free: {
            id: "f",
            slug: "free",
            nombre: "Free",
            tierOrder: 0,
            ars: { monthly: 0, yearly: 0 },
            usd: { monthly: 0, yearly: 0 },
            limits: { ordenes: 45, tecnicos: 1, clientes: 200, vendedores: 1, storageMb: 100, sucursales: 1 },
            featureFlags: { client_portal: true },
          },
        }}
      />
    )
    expect(screen.getByText("Hasta 45 reparaciones por mes")).toBeInTheDocument()
    expect(screen.getByText("Tus clientes siguen su reparación online")).toBeInTheDocument()
  })

  it("no muestra funciones tachadas y el Profesional lista lo que suma", () => {
    const { container } = render(<PricingSection prices={prices} />)
    expect(container.querySelector(".line-through")).toBeNull()
    expect(screen.getByText("Avisos automáticos por WhatsApp")).toBeInTheDocument()
    expect(screen.getByText("Hasta 3 sucursales")).toBeInTheDocument()
  })

  it("en /precios no linkea a sí misma", () => {
    render(<PricingSection prices={prices} showComparisonLink={false} />)
    expect(screen.queryByText("Ver la comparación completa de planes")).toBeNull()
  })

  it("los CTA son links, no botones dentro de links", () => {
    const { container } = render(<PricingSection prices={prices} />)
    expect(container.querySelector("a button, button a")).toBeNull()
    expect(screen.getByRole("link", { name: "Comenzar gratis" })).toHaveAttribute("href", "/registro")
  })
})

