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
      "No, STApp es una aplicación web que funciona directamente en tu navegador desde cualquier dispositivo. Solo necesitas conexión a internet. Además, podés descargar la app nativa para Android (APK), instalarla como PWA en cualquier dispositivo, y próximamente estará disponible también en iOS.",
  },
  {
    question: "¿Puedo probar antes de pagar?",
    answer:
      "¡Por supuesto! Tienes 30 días gratis con acceso completo a todas las funciones, sin necesidad de tarjeta de crédito. Si no te convence, simplemente no hacés nada y la prueba finaliza sin ningún cargo.",
  },
  {
    question: "¿Qué métodos de pago aceptan?",
    answer:
      "Aceptamos tarjetas de crédito, débito, efectivo y otros medios de pago a través de MercadoPago. Podés elegir entre plan mensual o anual (con descuento). Los pagos se procesan de forma segura.",
  },
  {
    question: "¿Puedo cancelar mi suscripción en cualquier momento?",
    answer:
      "Sí, podés cancelar cuando quieras sin penalidades ni cargos ocultos. Mantendrás el acceso a todas las funciones hasta el final del período ya facturado.",
  },
  {
    question: "¿Puedo importar y exportar mis datos?",
    answer:
      "Sí, podés importar clientes e inventario desde archivos Excel o CSV con plantillas descargables y validación automática. También podés exportar tus datos en cualquier momento. Tus datos son tuyos siempre.",
  },
  {
    question: "¿Mis datos están seguros?",
    answer:
      "Absolutamente. Usamos encriptación HTTPS/TLS, controles de acceso estrictos, monitoreo continuo y copias de seguridad periódicas. Tu información y la de tus clientes está protegida en todo momento.",
  },
  {
    question: "¿Cómo funcionan las notificaciones por WhatsApp?",
    answer:
      "STApp incluye plantillas listas para enviar actualizaciones a tus clientes por WhatsApp: aviso de equipo listo, presupuestos, seguimiento de reparación y más. Todo con un solo clic desde la orden de servicio.",
  },
  {
    question: "¿Puedo gestionar varios técnicos y vendedores?",
    answer:
      "Sí, podés agregar técnicos y vendedores ilimitados. Asigná reparaciones, visualizá la carga de trabajo de cada uno y seguí el rendimiento del equipo con métricas en tiempo real.",
  },
  {
    question: "¿Cómo puedo obtener soporte si tengo un problema?",
    answer:
      "Tenés varias opciones: nuestro asistente virtual Santi disponible dentro de la app, el sistema de tickets de soporte para reportar errores o hacer consultas, y también podés contactarnos directamente. Brindamos soporte prioritario a todos los usuarios.",
  },
  {
    question: "¿Pueden agregar funciones que necesito?",
    answer:
      "¡Claro! Estamos en constante mejora basándonos en el feedback de nuestros usuarios. Podés enviar sugerencias desde el sistema de soporte dentro de la app y muchas funciones nuevas nacen de las ideas de nuestros clientes.",
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
