import { auth } from "@/lib/auth"
import { NavbarLanding } from "@/components/landing/navbar-landing"
import { Hero } from "@/components/landing/hero"
import { Features } from "@/components/landing/features"
import { PricingSection } from "@/components/landing/pricing-section"
import { FAQ } from "@/components/landing/faq"
import { Footer } from "@/components/landing/footer"
import { ChatbotButton } from "@/components/chatbot/chatbot-button"

export const dynamic = "force-dynamic"

export default async function LandingPage() {
  const session = await auth()

  // Esta ruta SIEMPRE muestra la landing, incluso si está logueado
  return (
    <main className="min-h-screen">
      <NavbarLanding isLoggedIn={!!session} />
      <Hero />
      <Features />
      <PricingSection />
      <FAQ />
      <Footer />

      {/* Chatbot flotante */}
      <ChatbotButton />
    </main>
  )
}
