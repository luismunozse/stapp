import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { NavbarLanding } from "@/components/landing/navbar-landing"
import { PricingSection } from "@/components/landing/pricing-section"
import { FAQ } from "@/components/landing/faq"
import { Footer } from "@/components/landing/footer"
import { WhatsAppButton } from "@/components/landing/whatsapp-button"
import { getPremiumPrices } from "@/lib/pricing"
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
      "STApp ofrece una prueba gratuita de 30 días con todas las funciones incluidas, sin necesidad de tarjeta de crédito. Después podés elegir el plan Premium mensual o anual con descuento. Aceptamos MercadoPago (pesos argentinos) y pagos internacionales en dólares.",
  },
  {
    question: "¿Puedo probar STApp gratis?",
    answer:
      "Sí, tenés 30 días completamente gratis con acceso a todas las funciones premium. No se requiere tarjeta de crédito ni compromiso. Si no te convence, simplemente no hacés nada.",
  },
  {
    question: "¿Qué incluye el plan Premium?",
    answer:
      "El plan Premium incluye: órdenes de trabajo ilimitadas, gestión de clientes, control de inventario con alertas, facturación electrónica, notificaciones por WhatsApp, reportes avanzados, técnicos y vendedores ilimitados, app móvil Android, y soporte prioritario.",
  },
  {
    question: "¿Puedo cancelar en cualquier momento?",
    answer:
      "Sí, podés cancelar tu suscripción cuando quieras sin penalidades ni cargos ocultos. Mantendrás el acceso hasta el final del período ya pagado.",
  },
  {
    question: "¿Aceptan pagos desde otros países?",
    answer:
      "Sí, aceptamos pagos en pesos argentinos vía MercadoPago y en dólares estadounidenses para usuarios de otros países de Latinoamérica.",
  },
]

export default async function PreciosPage() {
  const [session, prices] = await Promise.all([auth(), getPremiumPrices()])

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
          <PricingSection prices={prices} />
          <FAQ faqs={pricingFaqs} />
        </div>
        <Footer />
        <WhatsAppButton />
      </main>
    </>
  )
}
