import Script from "next/script"
import { getPremiumPrices } from "@/lib/pricing"

const siteUrl = "https://stapp.com.ar"

// Organization Schema
export function OrganizationJsonLd() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "STApp",
    url: siteUrl,
    logo: `${siteUrl}/logo.png`,
    description:
      "Sistema de gestión para servicio técnico de dispositivos electrónicos. Administra órdenes de trabajo, clientes, inventario y facturación.",
    foundingDate: "2024",
    sameAs: ["https://twitter.com/stapp_ar"],
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "Customer Support",
      email: "soporte@stapp.com",
      availableLanguage: ["Spanish"],
    },
    address: {
      "@type": "PostalAddress",
      addressCountry: "AR",
      addressLocality: "Buenos Aires",
    },
  }

  return (
    <Script
      id="jsonld-organization"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}

// SoftwareApplication Schema
export async function SoftwareApplicationJsonLd() {
  const prices = await getPremiumPrices()
  const schema = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "STApp",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    offers: {
      "@type": "Offer",
      price: String(prices.ars.monthly),
      priceCurrency: "ARS",
      priceValidUntil: "2026-12-31",
    },
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: "4.8",
      ratingCount: "150",
    },
    description:
      "Software de gestión para talleres de reparación de dispositivos electrónicos. Incluye órdenes de trabajo, clientes, inventario y facturación.",
    featureList: [
      "Gestión de órdenes de trabajo",
      "Administración de clientes",
      "Control de inventario",
      "Facturación electrónica",
      "Reportes y estadísticas",
      "Multi-técnico",
    ],
  }

  return (
    <Script
      id="jsonld-software-application"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}

// WebSite Schema with SearchAction
export function WebSiteJsonLd() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "STApp",
    url: siteUrl,
    description:
      "Sistema de gestión para servicio técnico de dispositivos electrónicos",
    publisher: {
      "@type": "Organization",
      name: "STApp",
    },
  }

  return (
    <Script
      id="jsonld-website"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}

// FAQPage Schema
interface FAQItem {
  question: string
  answer: string
}

export function FAQPageJsonLd({ faqs }: { faqs: FAQItem[] }) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  }

  return (
    <Script
      id="jsonld-faq"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}

// LocalBusiness Schema (para página de contacto)
export function LocalBusinessJsonLd() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: "STApp",
    image: `${siteUrl}/logo.png`,
    url: siteUrl,
    telephone: "+54 11 1234-5678",
    email: "soporte@stapp.com",
    address: {
      "@type": "PostalAddress",
      addressLocality: "Buenos Aires",
      addressCountry: "AR",
    },
    openingHoursSpecification: {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      opens: "09:00",
      closes: "18:00",
    },
    priceRange: "$$",
  }

  return (
    <Script
      id="jsonld-local-business"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}

// BreadcrumbList Schema
interface BreadcrumbItem {
  name: string
  url: string
}

export function BreadcrumbJsonLd({ items }: { items: BreadcrumbItem[] }) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  }

  return (
    <Script
      id="jsonld-breadcrumb"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}
