import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { NavbarLanding } from "@/components/landing/navbar-landing"
import { Hero } from "@/components/landing/hero"
// import { ProductShowcase } from "@/components/landing/product-showcase"
import { Features } from "@/components/landing/features"
import { PricingSection } from "@/components/landing/pricing-section"
import { FAQ } from "@/components/landing/faq"
import { Footer } from "@/components/landing/footer"
import { ChatbotButton } from "@/components/chatbot/chatbot-button"
import { SkipLinks } from "@/components/shared/skip-links"

// Forzar renderizado dinámico para verificar auth en cada navegación
export const dynamic = "force-dynamic"

export default async function Home() {
  const session = await auth()

  // Si el usuario está autenticado, redirigir al dashboard
  if (session) {
    redirect("/dashboard")
  }

  // Mostrar landing page para usuarios no autenticados
  return (
    <>
      <SkipLinks />
      <main id="main-content" className="min-h-screen">
        <NavbarLanding />
        <Hero />
        {/* <ProductShowcase /> */}
        <Features />
        <PricingSection />
        <FAQ />
        <Footer />
        {/* Chatbot flotante */}
        <ChatbotButton />
      </main>
    </>
  )
}

