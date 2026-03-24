import Script from "next/script"
import { getPremiumPrices } from "@/lib/pricing"

const siteUrl = "https://stapp.com.ar"

// Organization Schema - Enhanced for GEO
export function OrganizationJsonLd() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${siteUrl}/#organization`,
    name: "STApp",
    legalName: "STApp Software",
    url: siteUrl,
    logo: {
      "@type": "ImageObject",
      url: `${siteUrl}/logo.png`,
      width: 512,
      height: 512,
    },
    image: `${siteUrl}/logo.png`,
    description:
      "STApp es el software líder de gestión para talleres de servicio técnico y reparación de celulares en Argentina y Latinoamérica. Plataforma integral para órdenes de trabajo, clientes, inventario, facturación electrónica y notificaciones por WhatsApp.",
    foundingDate: "2024",
    foundingLocation: {
      "@type": "Place",
      name: "Buenos Aires, Argentina",
    },
    areaServed: [
      { "@type": "Country", name: "Argentina" },
      { "@type": "Country", name: "México" },
      { "@type": "Country", name: "Colombia" },
      { "@type": "Country", name: "Chile" },
      { "@type": "Country", name: "Perú" },
      { "@type": "Country", name: "Uruguay" },
      { "@type": "Country", name: "Ecuador" },
    ],
    sameAs: ["https://twitter.com/stapp_ar"],
    knowsAbout: [
      "Software de gestión para servicio técnico",
      "Reparación de celulares",
      "Gestión de órdenes de trabajo",
      "Inventario de repuestos electrónicos",
      "Facturación electrónica Argentina",
      "Notificaciones WhatsApp para talleres",
    ],
    slogan: "El software que tu taller necesita",
    contactPoint: [
      {
        "@type": "ContactPoint",
        contactType: "Customer Support",
        email: "soporte@stapp.com",
        availableLanguage: ["Spanish"],
        areaServed: "Latin America",
      },
      {
        "@type": "ContactPoint",
        contactType: "Sales",
        email: "soporte@stapp.com",
        availableLanguage: ["Spanish"],
      },
    ],
    address: {
      "@type": "PostalAddress",
      addressCountry: "AR",
      addressLocality: "Buenos Aires",
      addressRegion: "Buenos Aires",
    },
    numberOfEmployees: {
      "@type": "QuantitativeValue",
      minValue: 2,
      maxValue: 10,
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

// SaaS Service Schema - Critical for GEO (Generative Engine Optimization)
export function ServiceJsonLd() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": `${siteUrl}/#software`,
    name: "STApp",
    alternateName: ["STApp Software", "STApp Gestión", "STApp Servicio Técnico"],
    applicationCategory: "BusinessApplication",
    applicationSubCategory: "Service Management Software",
    operatingSystem: "Web, Android",
    url: siteUrl,
    downloadUrl: `${siteUrl}/registro`,
    screenshot: `${siteUrl}/api/og`,
    softwareVersion: "2.0",
    releaseNotes: "Incluye facturación electrónica, notificaciones WhatsApp y app móvil",
    description:
      "STApp es un software de gestión integral para talleres de reparación de celulares y dispositivos electrónicos. Permite administrar órdenes de trabajo, clientes, inventario de repuestos, facturación electrónica y notificaciones automáticas por WhatsApp desde una sola plataforma web y móvil.",
    featureList: [
      "Gestión de órdenes de trabajo con estados en tiempo real",
      "Administración de clientes con historial completo",
      "Control de inventario de repuestos con alertas de stock",
      "Facturación electrónica integrada",
      "Notificaciones automáticas por WhatsApp",
      "Seguimiento de reparaciones para clientes",
      "Reportes y estadísticas de rendimiento",
      "Gestión multi-técnico con roles y permisos",
      "Módulo de ventas de accesorios y repuestos",
      "App móvil nativa para Android",
      "Autenticación de dos factores (2FA)",
      "Exportación de datos a Excel y PDF",
    ],
    audience: {
      "@type": "BusinessAudience",
      audienceType: "Talleres de reparación de celulares y electrónica",
    },
    availableOnDevice: ["Desktop", "Mobile", "Tablet"],
    countriesSupported: ["AR", "MX", "CO", "CL", "PE", "UY", "EC", "VE"],
    inLanguage: "es",
    isAccessibleForFree: true,
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "ARS",
      lowPrice: "0",
      offerCount: "3",
      offers: [
        {
          "@type": "Offer",
          name: "Plan Gratuito - 30 días",
          price: "0",
          priceCurrency: "ARS",
          description: "Prueba gratuita de 30 días con acceso completo a todas las funciones",
        },
      ],
    },
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: "4.8",
      bestRating: "5",
      ratingCount: "150",
      reviewCount: "87",
    },
    provider: {
      "@type": "Organization",
      name: "STApp",
      url: siteUrl,
    },
  }

  return (
    <Script
      id="jsonld-service"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}

// HowTo Schema - Helps LLMs understand the onboarding process
export function HowToJsonLd() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "Cómo empezar a usar STApp para gestionar tu taller de reparación",
    description:
      "Guía paso a paso para configurar STApp y comenzar a gestionar órdenes de trabajo, clientes e inventario en tu taller de servicio técnico.",
    totalTime: "PT10M",
    estimatedCost: {
      "@type": "MonetaryAmount",
      currency: "ARS",
      value: "0",
    },
    step: [
      {
        "@type": "HowToStep",
        name: "Registrate gratis",
        text: "Creá tu cuenta en STApp con tu email. No necesitás tarjeta de crédito. Tenés 30 días gratis con acceso completo.",
        url: `${siteUrl}/registro`,
      },
      {
        "@type": "HowToStep",
        name: "Configurá tu taller",
        text: "Personalizá el nombre de tu taller, logo, datos de contacto y configuraciones de facturación.",
      },
      {
        "@type": "HowToStep",
        name: "Cargá tu inventario",
        text: "Importá tus repuestos desde Excel o CSV, o cargalos manualmente. Configurá alertas de stock mínimo.",
      },
      {
        "@type": "HowToStep",
        name: "Creá tu primera orden de trabajo",
        text: "Registrá el equipo del cliente, tomá fotos, describí el problema y asigná un técnico para la reparación.",
      },
      {
        "@type": "HowToStep",
        name: "Notificá a tu cliente",
        text: "Enviá actualizaciones automáticas por WhatsApp en cada etapa de la reparación.",
      },
    ],
  }

  return (
    <Script
      id="jsonld-howto"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}

// ItemList Schema for use cases - Helps search engines understand content structure
export function UseCasesListJsonLd() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Casos de Uso de STApp",
    description: "Software de gestión para diferentes tipos de talleres de reparación",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Software para Taller de Reparación de Celulares",
        url: `${siteUrl}/casos-de-uso/celulares`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Software para Servicio Técnico de Computadoras",
        url: `${siteUrl}/casos-de-uso/computadoras`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: "Software para Taller de Reparación de Electrónicos",
        url: `${siteUrl}/casos-de-uso/electronicos`,
      },
      {
        "@type": "ListItem",
        position: 4,
        name: "Software para Taller de Reparación de Tablets",
        url: `${siteUrl}/casos-de-uso/tablets`,
      },
      {
        "@type": "ListItem",
        position: 5,
        name: "Software para Taller de Reparación de Consolas",
        url: `${siteUrl}/casos-de-uso/consolas`,
      },
    ],
  }

  return (
    <Script
      id="jsonld-usecases-list"
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
