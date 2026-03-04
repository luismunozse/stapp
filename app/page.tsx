import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { NavbarLanding } from "@/components/landing/navbar-landing"
import { Hero } from "@/components/landing/hero"
import { Features } from "@/components/landing/features"
import { VideoDemo } from "@/components/landing/video-demo"
import { PricingSection } from "@/components/landing/pricing-section"
import { FAQ } from "@/components/landing/faq"
import { DownloadApp } from "@/components/landing/download-app"
import { Footer } from "@/components/landing/footer"
import { ChatbotButton } from "@/components/chatbot/chatbot-button"
import { SkipLinks } from "@/components/shared/skip-links"
import { FAQPageJsonLd } from "@/components/seo/json-ld"

export const metadata: Metadata = {
  title: "Software de Gesti\u00f3n para Servicio T\u00e9cnico | Reparaci\u00f3n de Celulares",
  description:
    "STApp es el software de gesti\u00f3n m\u00e1s completo para talleres de reparaci\u00f3n de celulares y dispositivos electr\u00f3nicos. Administra \u00f3rdenes de trabajo, clientes, inventario y facturaci\u00f3n. 30 d\u00edas gratis.",
  keywords: [
    "software servicio t\u00e9cnico",
    "gesti\u00f3n taller reparaci\u00f3n",
    "sistema \u00f3rdenes de trabajo",
    "software reparaci\u00f3n celulares",
    "gesti\u00f3n clientes taller",
    "control de cobros taller",
    "inventario repuestos",
    "software taller de reparaci\u00f3n de celulares",
    "sistema gesti\u00f3n servicio t\u00e9cnico",
  ],
  openGraph: {
    title: "STApp - Software de Gesti\u00f3n para Servicio T\u00e9cnico y Reparaci\u00f3n",
    description:
      "El sistema m\u00e1s completo para talleres de reparaci\u00f3n de celulares. \u00d3rdenes de trabajo, clientes, inventario y cobros en una plataforma.",
    url: "https://stapp.com.ar",
  },
  alternates: {
    canonical: "https://stapp.com.ar",
  },
}

const faqData = [
  {
    question: "\u00bfNecesito instalar algo en mi computadora?",
    answer:
      "No, STApp es una aplicaci\u00f3n web que funciona directamente en tu navegador desde cualquier dispositivo. Solo necesitas conexi\u00f3n a internet. Adem\u00e1s, pod\u00e9s descargar la app nativa para Android (APK), instalarla como PWA en cualquier dispositivo, y pr\u00f3ximamente estar\u00e1 disponible tambi\u00e9n en iOS.",
  },
  {
    question: "\u00bfPuedo probar antes de pagar?",
    answer:
      "\u00a1Por supuesto! Tienes 30 d\u00edas gratis con acceso completo a todas las funciones, sin necesidad de tarjeta de cr\u00e9dito. Si no te convence, simplemente no hac\u00e9s nada y la prueba finaliza sin ning\u00fan cargo.",
  },
  {
    question: "\u00bfQu\u00e9 m\u00e9todos de pago aceptan?",
    answer:
      "Aceptamos tarjetas de cr\u00e9dito, d\u00e9bito, efectivo y otros medios de pago a trav\u00e9s de MercadoPago. Pod\u00e9s elegir entre plan mensual o anual (con descuento). Los pagos se procesan de forma segura.",
  },
  {
    question: "\u00bfPuedo cancelar mi suscripci\u00f3n en cualquier momento?",
    answer:
      "S\u00ed, pod\u00e9s cancelar cuando quieras sin penalidades ni cargos ocultos. Mantendr\u00e1s el acceso a todas las funciones hasta el final del per\u00edodo ya facturado.",
  },
  {
    question: "\u00bfPuedo importar y exportar mis datos?",
    answer:
      "S\u00ed, pod\u00e9s importar clientes e inventario desde archivos Excel o CSV con plantillas descargables y validaci\u00f3n autom\u00e1tica. Tambi\u00e9n pod\u00e9s exportar tus datos en cualquier momento. Tus datos son tuyos siempre.",
  },
  {
    question: "\u00bfMis datos est\u00e1n seguros?",
    answer:
      "Absolutamente. Usamos encriptaci\u00f3n HTTPS/TLS, controles de acceso estrictos, monitoreo continuo y copias de seguridad peri\u00f3dicas. Tu informaci\u00f3n y la de tus clientes est\u00e1 protegida en todo momento.",
  },
  {
    question: "\u00bfC\u00f3mo funcionan las notificaciones por WhatsApp?",
    answer:
      "STApp incluye plantillas listas para enviar actualizaciones a tus clientes por WhatsApp: aviso de equipo listo, presupuestos, seguimiento de reparaci\u00f3n y m\u00e1s. Todo con un solo clic desde la orden de servicio.",
  },
  {
    question: "\u00bfPuedo gestionar varios t\u00e9cnicos y vendedores?",
    answer:
      "S\u00ed, pod\u00e9s agregar t\u00e9cnicos y vendedores ilimitados. Asign\u00e1 reparaciones, visualiz\u00e1 la carga de trabajo de cada uno y segu\u00ed el rendimiento del equipo con m\u00e9tricas en tiempo real.",
  },
  {
    question: "\u00bfC\u00f3mo puedo obtener soporte si tengo un problema?",
    answer:
      "Ten\u00e9s varias opciones: nuestro asistente virtual Santi disponible dentro de la app, el sistema de tickets de soporte para reportar errores o hacer consultas, y tambi\u00e9n pod\u00e9s contactarnos directamente. Brindamos soporte prioritario a todos los usuarios.",
  },
  {
    question: "\u00bfPueden agregar funciones que necesito?",
    answer:
      "\u00a1Claro! Estamos en constante mejora bas\u00e1ndonos en el feedback de nuestros usuarios. Pod\u00e9s enviar sugerencias desde el sistema de soporte dentro de la app y muchas funciones nuevas nacen de las ideas de nuestros clientes.",
  },
]

export default async function Home() {
  const session = await auth()

  // Si el usuario est\u00e1 autenticado, redirigir al dashboard
  if (session) {
    redirect("/dashboard")
  }

  // Mostrar landing page para usuarios no autenticados
  return (
    <>
      <FAQPageJsonLd faqs={faqData} />
      <SkipLinks />
      <main id="main-content" className="min-h-screen">
        <NavbarLanding />
        <Hero />
        <Features />
        <VideoDemo />
        <PricingSection />
        <DownloadApp />
        <FAQ faqs={faqData} />
        <Footer />
        <ChatbotButton />
      </main>
    </>
  )
}
