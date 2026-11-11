import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { NavbarLanding } from "@/components/landing/navbar-landing"
import { PricingSection } from "@/components/landing/pricing-section"
import { FAQ } from "@/components/landing/faq"
import { Footer } from "@/components/landing/footer"
import { WhatsAppButton } from "@/components/landing/whatsapp-button"
import { PricingPageTracker } from "@/components/marketing/pricing-page-tracker"
import { getPremiumPrices, getAllPlanPrices } from "@/lib/pricing"
import { FAQPageJsonLd, BreadcrumbJsonLd } from "@/components/seo/json-ld"
import { OG_IMAGES } from "@/lib/og/metadata"
import { buildPricingFaqs, getFreePlanInfo } from "@/lib/plan-copy"

export const metadata: Metadata = {
  title: "Precios y Planes | Software de Gestión para Servicio Técnico",
  description:
    "Conocé los planes y precios de STApp. Desde gratis hasta premium. Software completo para gestionar tu taller de reparación de celulares con órdenes de trabajo, inventario y facturación. 30 días de prueba gratis.",
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

export default async function PreciosPage() {
  const [session, prices, allPlans] = await Promise.all([auth(), getPremiumPrices(), getAllPlanPrices()])

  if (session) {
    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("slug")
      .eq("id", session.user.organizationId)
      .single()

    if (org?.slug) {
      const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"
      const protocol = process.env.NODE_ENV === "production" ? "https" : "http"
      redirect(`${protocol}://${org.slug}.${rootDomain}/dashboard`)
    }
  }

  // Límites del Free leídos de la tabla plans (misma fuente que la card).
  const pricingFaqs = buildPricingFaqs(getFreePlanInfo(allPlans))

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
          <PricingSection prices={prices} allPlans={allPlans} />
          <FAQ faqs={pricingFaqs} />
        </div>
        <Footer />
        <WhatsAppButton />
      </main>
    </>
  )
}
