import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { NavbarLanding } from "@/components/landing/navbar-landing"
import { Hero } from "@/components/landing/hero"
import { Features } from "@/components/landing/features"
import { PricingSection } from "@/components/landing/pricing-section"
import { Comparison } from "@/components/landing/comparison"
import { UseCasesGrid } from "@/components/landing/use-cases-grid"
import { BlogTeaser } from "@/components/landing/blog-teaser"
import { FAQ } from "@/components/landing/faq"
import { DownloadApp } from "@/components/landing/download-app"
import { Footer } from "@/components/landing/footer"
import { ChatbotButton } from "@/components/chatbot/chatbot-button"
import { WhatsAppButton } from "@/components/landing/whatsapp-button"
import { ReducedMotionProvider } from "@/components/landing/reduced-motion-provider"
import { getPremiumPrices, getAllPlanPrices } from "@/lib/pricing"
import { SkipLinks } from "@/components/shared/skip-links"
import { FAQPageJsonLd, HowToJsonLd, UseCasesListJsonLd } from "@/components/seo/json-ld"

export const metadata: Metadata = {
  title: "Software de Gestión para Servicio Técnico | Reparación de Celulares y Electrónica",
  description:
    "STApp es el software #1 para talleres de reparación de celulares y servicio técnico en Argentina. Órdenes de trabajo, caja diaria, inventario, punto de venta, finanzas, cotizaciones, leads, reportes avanzados, asistente IA y notificaciones WhatsApp. Probá 30 días gratis sin tarjeta.",
  keywords: [
    "software servicio técnico",
    "gestión taller reparación",
    "sistema órdenes de trabajo",
    "software reparación celulares",
    "gestión clientes taller",
    "control de cobros taller",
    "inventario repuestos",
    "software taller de reparación de celulares",
    "sistema gestión servicio técnico",
    "programa para taller de celulares",
    "app servicio técnico",
    "facturación electrónica taller",
    "notificaciones WhatsApp reparaciones",
    "seguimiento de reparaciones online",
    "software gestión taller electrónica argentina",
    "mejor software servicio técnico",
    "sistema de reparaciones gratis",
    "caja diaria taller",
    "control de gastos taller",
    "punto de venta reparaciones",
    "dashboard taller celulares",
    "leads servicio técnico",
    "asistente IA taller",
    "órdenes de compra repuestos",
    "gestión financiera taller",
  ],
  openGraph: {
    title: "STApp - Software de Gestión para Talleres de Celulares",
    description:
      "Gestión completa de tu taller: órdenes, inventario, ventas y finanzas. +500 talleres en Argentina. Probá 30 días gratis.",
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
      "Absolutamente. Usamos encriptaci\u00f3n HTTPS/TLS, autenticaci\u00f3n de dos factores (2FA) con c\u00f3digos de respaldo, controles de acceso estrictos, monitoreo continuo y copias de seguridad peri\u00f3dicas. Tu informaci\u00f3n y la de tus clientes est\u00e1 protegida en todo momento.",
  },
  {
    question: "\u00bfC\u00f3mo funcionan las notificaciones por WhatsApp?",
    answer:
      "STApp incluye plantillas listas para enviar actualizaciones a tus clientes por WhatsApp: aviso de equipo listo, presupuestos, seguimiento de reparaci\u00f3n y m\u00e1s. Todo con un solo clic desde la orden de servicio.",
  },
  {
    question: "\u00bfPuedo gestionar varios t\u00e9cnicos y vendedores?",
    answer:
      "S\u00ed, pod\u00e9s agregar t\u00e9cnicos y vendedores ilimitados con roles diferenciados (admin, t\u00e9cnico, vendedor). Asign\u00e1 reparaciones, visualiz\u00e1 la carga de trabajo de cada uno y segu\u00ed el rendimiento del equipo con m\u00e9tricas en tiempo real.",
  },
  {
    question: "\u00bfMi cliente puede ver el estado de su reparaci\u00f3n?",
    answer:
      "S\u00ed. Cada orden genera un link \u00fanico que pod\u00e9s compartir por WhatsApp. Tu cliente ve el estado en tiempo real, las fotos, la informaci\u00f3n de garant\u00eda y puede descargar el comprobante en PDF. No necesita crear cuenta ni instalar nada.",
  },
  {
    question: "\u00bfPuedo vender accesorios y repuestos adem\u00e1s de reparar?",
    answer:
      "S\u00ed, STApp incluye un m\u00f3dulo de ventas completo. Registr\u00e1 ventas con garant\u00eda por producto, m\u00faltiples medios de pago, gesti\u00f3n de devoluciones y seguimiento de vendedores con m\u00e9tricas individuales.",
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
  {
    question: "\u00bfSTApp tiene control de caja y finanzas?",
    answer:
      "S\u00ed. STApp incluye caja diaria con apertura y cierre, control de movimientos de efectivo, gesti\u00f3n de gastos por categor\u00eda, gastos recurrentes (alquiler, servicios, sueldos) y un dashboard anal\u00edtico con los KPIs de tu taller en tiempo real. Tambi\u00e9n pod\u00e9s gestionar \u00f3rdenes de compra a proveedores vinculadas directamente al inventario.",
  },
  {
    question: "\u00bfQu\u00e9 es Santi, el asistente de IA?",
    answer:
      "Santi es tu asistente virtual integrado dentro de STApp, disponible 24/7. Pod\u00e9s preguntarle c\u00f3mo usar cualquier funci\u00f3n, pedirle ayuda para resolver problemas, o que te gu\u00ede paso a paso. Es como tener soporte t\u00e9cnico instant\u00e1neo sin esperar.",
  },
  {
    question: "\u00bfPuedo captar leads y darles seguimiento?",
    answer:
      "S\u00ed. STApp incluye un m\u00f3dulo de captaci\u00f3n de leads donde pod\u00e9s registrar consultas y potenciales clientes. Hac\u00e9 seguimiento de cada lead hasta convertirlo en una orden de trabajo real, sin que se te escape ninguna oportunidad.",
  },
]

export default async function Home() {
  const [session, prices, allPlans] = await Promise.all([
    auth(),
    getPremiumPrices(),
    getAllPlanPrices(),
  ])

  // Si el usuario est\u00e1 autenticado, redirigir a su subdominio de tenant
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

    // Fallback: si no se encuentra el slug, mostrar landing
  }

  // Mostrar landing page para usuarios no autenticados
  return (
    <>
      <FAQPageJsonLd faqs={faqData} />
      <HowToJsonLd />
      <UseCasesListJsonLd />
      <SkipLinks />
      <main id="main-content" className="min-h-dvh">
        <ReducedMotionProvider>
          <NavbarLanding />
          <Hero />
          <Features />
          <Comparison />
          <UseCasesGrid />
          <PricingSection prices={prices} allPlans={allPlans} />
          <BlogTeaser />
          <FAQ faqs={faqData} />
          <DownloadApp />
          <Footer />
          <WhatsAppButton />
          <ChatbotButton />
        </ReducedMotionProvider>
      </main>
    </>
  )
}
