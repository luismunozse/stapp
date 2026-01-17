import type { Metadata } from "next"
import { auth } from "@/lib/auth"
import { NavbarLanding } from "@/components/landing/navbar-landing"
import { Hero } from "@/components/landing/hero"
import { Features } from "@/components/landing/features"
import { PricingSection } from "@/components/landing/pricing-section"
import { FAQ } from "@/components/landing/faq"
import { Footer } from "@/components/landing/footer"
import { ChatbotButton } from "@/components/chatbot/chatbot-button"
import { FAQPageJsonLd } from "@/components/seo/json-ld"

export const metadata: Metadata = {
  title: "Software de Gestión para Servicio Técnico",
  description:
    "STApp es el sistema de gestión más completo para talleres de reparación. Administra órdenes de trabajo, clientes, inventario y facturación desde una sola plataforma. Prueba gratis.",
  keywords: [
    "software servicio técnico",
    "gestión taller reparación",
    "sistema órdenes de trabajo",
    "software reparación celulares",
    "gestión clientes taller",
    "facturación servicio técnico",
    "inventario repuestos",
  ],
  openGraph: {
    title: "STApp - Software de Gestión para Servicio Técnico",
    description:
      "El sistema más completo para talleres de reparación. Órdenes de trabajo, clientes, inventario y facturación en una plataforma.",
    url: "https://stapp.com.ar/landing",
  },
  alternates: {
    canonical: "https://stapp.com.ar/landing",
  },
}

export const dynamic = "force-dynamic"

const faqData = [
  {
    question: "¿Necesito instalar algo en mi computadora?",
    answer:
      "No, STApp es una aplicación web que funciona en tu navegador. Solo necesitas conexión a internet. También puedes instalarlo como app en tu celular (PWA).",
  },
  {
    question: "¿Puedo probar antes de pagar?",
    answer:
      "¡Claro! El plan Free es completamente gratuito y puedes usarlo el tiempo que quieras. Cuando necesites más capacidad, puedes actualizar a Premium.",
  },
  {
    question: "¿Qué métodos de pago aceptan?",
    answer:
      "Aceptamos tarjetas de crédito, débito, efectivo y otros medios de pago a través de MercadoPago.",
  },
  {
    question: "¿Puedo cancelar mi suscripción en cualquier momento?",
    answer:
      "Sí, puedes cancelar cuando quieras. Mantendrás el acceso a las funciones Premium hasta el final del período facturado. No hay penalidades ni cargos ocultos.",
  },
  {
    question: "¿Mis datos están seguros?",
    answer:
      "Absolutamente. Usamos encriptación de nivel bancario, backups automáticos diarios y cumplimos con las mejores prácticas de seguridad. Tus datos están protegidos 24/7.",
  },
  {
    question: "¿Puedo importar mis datos de otro sistema?",
    answer:
      "Sí, ofrecemos importación de datos desde Excel/CSV. Si tienes un sistema anterior, nuestro equipo de soporte puede ayudarte con la migración.",
  },
  {
    question: "¿Hay soporte en español?",
    answer:
      "Sí, todo el sistema está en español y nuestro equipo de soporte también. Estamos disponibles por email y chat para ayudarte con cualquier duda.",
  },
  {
    question: "¿Pueden agregar funciones que necesito?",
    answer:
      "Estamos constantemente mejorando el sistema basándonos en feedback de usuarios. Escuchamos las sugerencias y muchas funciones nuevas vienen de nuestros clientes.",
  },
]

export default async function LandingPage() {
  const session = await auth()

  // Esta ruta SIEMPRE muestra la landing, incluso si está logueado
  return (
    <>
      <FAQPageJsonLd faqs={faqData} />
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
    </>
  )
}
