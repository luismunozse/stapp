import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { NavbarLanding } from "@/components/landing/navbar-landing"
import { PricingSection } from "@/components/landing/pricing-section"
import { FAQ } from "@/components/landing/faq"
import { Footer } from "@/components/landing/footer"
import { WhatsAppButton } from "@/components/landing/whatsapp-button"
import { getPremiumPrices, getAllPlanPrices } from "@/lib/pricing"
import { FAQPageJsonLd, BreadcrumbJsonLd } from "@/components/seo/json-ld"

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
    title: "Precios STApp - Software de Gestión para Talleres de Reparación",
    description:
      "Planes accesibles para tu taller. Desde $0 con 30 días gratis. Órdenes de trabajo, inventario, facturación y WhatsApp incluidos.",
    url: "https://stapp.com.ar/precios",
  },
  alternates: {
    canonical: "https://stapp.com.ar/precios",
  },
}

const pricingFaqs = [
  {
    question: "¿Cuánto cuesta STApp?",
    answer:
      "STApp tiene un plan Free gratuito para siempre con funciones básicas, y un plan Profesional con todas las funciones desbloqueadas. Al registrarte, tenés 30 días gratis con acceso total al plan Profesional. Aceptamos MercadoPago (pesos argentinos) y pagos internacionales en dólares.",
  },
  {
    question: "¿Puedo probar STApp gratis?",
    answer:
      "Sí, al registrarte tenés 30 días con acceso completo al plan Profesional, sin tarjeta de crédito. Si no te convence, tu cuenta pasa automáticamente al plan Free sin perder tus datos.",
  },
  {
    question: "¿Qué incluye el plan Profesional?",
    answer:
      "El plan Profesional incluye: órdenes de trabajo ilimitadas, gestión de clientes, control de inventario con alertas, punto de venta con garantías, cotizaciones con aprobación online, notificaciones por WhatsApp, portal de seguimiento para clientes, 15+ reportes avanzados, técnicos y vendedores ilimitados, modo kiosco, tu logo en presupuestos, y soporte prioritario.",
  },
  {
    question: "¿Qué incluye el plan Free?",
    answer:
      "El plan Free incluye hasta 15 órdenes por mes, 1 técnico, hasta 30 clientes, inventario básico y 100MB de almacenamiento. Es ideal para conocer STApp y para talleres muy pequeños.",
  },
  {
    question: "¿Puedo cancelar en cualquier momento?",
    answer:
      "Sí, podés cancelar tu suscripción cuando quieras sin penalidades ni cargos ocultos. Tu cuenta pasa al plan Free y mantenés todos tus datos.",
  },
  {
    question: "¿Aceptan pagos desde otros países?",
    answer:
      "Sí, aceptamos pagos en pesos argentinos vía MercadoPago y en dólares estadounidenses para usuarios de otros países de Latinoamérica.",
  },
]

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

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Inicio", url: "https://stapp.com.ar" },
          { name: "Precios", url: "https://stapp.com.ar/precios" },
        ]}
      />
      <FAQPageJsonLd faqs={pricingFaqs} />
      <main className="min-h-screen">
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
