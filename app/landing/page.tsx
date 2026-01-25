import type { Metadata } from "next"
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
    "control de cobros taller",
    "inventario repuestos",
  ],
  openGraph: {
    title: "STApp - Software de Gestión para Servicio Técnico",
    description:
      "El sistema más completo para talleres de reparación. Órdenes de trabajo, clientes, inventario y cobros en una plataforma.",
    url: "https://stapp.com.ar/landing",
  },
  alternates: {
    canonical: "https://stapp.com.ar/landing",
  },
}

// Landing page estática - la sesión se verifica del lado del cliente en el navbar
export const revalidate = 3600 // Revalidar cada hora

const faqData = [
  {
    question: "¿Necesito instalar algo en mi computadora?",
    answer:
      "No, STApp es una aplicación web que funciona en tu navegador. Solo necesitas conexión a internet. También puedes instalarlo como app en tu celular (PWA).",
  },
  {
    question: "¿Puedo probar antes de pagar?",
    answer:
      "¡Claro! Tienes 30 días gratis para probar todas las funciones sin necesidad de tarjeta de crédito. Si no te convence, puedes cancelar antes de que termine el período de prueba sin ningún cargo.",
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
    question: "¿Puedo importar mis datos de otro sistema?",
    answer:
      "Sí, puedes importar clientes e inventario desde archivos Excel o CSV. El sistema incluye plantillas descargables y validación automática para facilitar el proceso.",
  },
  {
    question: "¿Pueden agregar funciones que necesito?",
    answer:
      "Estamos constantemente mejorando el sistema basándonos en feedback de usuarios. Escuchamos las sugerencias y muchas funciones nuevas vienen de nuestros clientes.",
  },
]

export default function LandingPage() {
  return (
    <>
      <FAQPageJsonLd faqs={faqData} />
      <main className="min-h-screen">
        <NavbarLanding />
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
