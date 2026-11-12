import type { Metadata } from "next"
import { NavbarLanding } from "@/components/landing/navbar-landing"
import { PricingSection } from "@/components/landing/pricing-section"
import { FAQ } from "@/components/landing/faq"
import { Footer } from "@/components/landing/footer"
import { PlanComparison } from "@/components/landing/comparison"
import { WhatsAppFloat } from "@/components/marketing/whatsapp-float"
import { PricingPageTracker } from "@/components/marketing/pricing-page-tracker"
import { getPremiumPrices, getAllPlanPrices } from "@/lib/pricing"
import { FAQPageJsonLd, BreadcrumbJsonLd } from "@/components/seo/json-ld"
import { OG_IMAGES } from "@/lib/og/metadata"
import { buildPricingFaqs, getFreePlanInfo } from "@/lib/plan-copy"

export const metadata: Metadata = {
  title: "Precios y Planes | Software de Gestión para Servicio Técnico",
  description:
    "Conocé los planes y precios de STApp. Plan Free y plan Profesional. Software completo para gestionar tu taller de reparación de celulares con órdenes de trabajo, inventario y facturación. 30 días de prueba gratis.",
  keywords: [
    "precios software servicio técnico",
    "planes software taller reparación",
    "cuánto cuesta software servicio técnico",
    "software reparación celulares precio",
    "sistema gestión taller gratis",
    "stapp precios",
    "software taller celulares barato",
    "gestión servicio técnico planes",
  ],
  openGraph: {
    images: OG_IMAGES,
    title: "Precios STApp - Software de Gestión para Talleres de Reparación",
    description:
      "Planes accesibles para tu taller. Desde $0 con 30 días gratis. Órdenes de trabajo, inventario, facturación y WhatsApp incluidos.",
    url: "https://stapp.com.ar/precios",
  },
  alternates: {
    canonical: "https://stapp.com.ar/precios",
  },
}

// Sin auth() por request: al usuario logueado lo redirige el proxy.
export default async function PreciosPage() {
  const [prices, allPlans] = await Promise.all([getPremiumPrices(), getAllPlanPrices()])

  // Límites del Free leídos de la tabla plans (misma fuente que la card).
  const pricingFaqs = buildPricingFaqs(getFreePlanInfo(allPlans), allPlans)

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Inicio", url: "https://stapp.com.ar" },
          { name: "Precios", url: "https://stapp.com.ar/precios" },
        ]}
      />
      <FAQPageJsonLd faqs={pricingFaqs} />
      <PricingPageTracker />
      <main className="min-h-dvh">
        <NavbarLanding />
        <div className="pt-20">
          <PricingSection prices={prices} allPlans={allPlans} showComparisonLink={false} />
          <PlanComparison allPlans={allPlans} />
          <FAQ faqs={pricingFaqs} />
        </div>
        <Footer />
        <WhatsAppFloat message="Hola! Tengo una consulta sobre los planes de STApp." />
      </main>
    </>
  )
}
