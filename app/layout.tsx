import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"
import { headers } from "next/headers"
import Script from "next/script"
import "./globals.css"
import { PWAInstaller } from "@/components/pwa/pwa-installer"
import { PWARecovery } from "@/components/pwa/pwa-recovery"
import { PWAUpdater } from "@/components/pwa/pwa-updater"
import { Providers } from "@/components/providers"
import { CookieConsent } from "@/components/cookie-consent"
import {
  OrganizationJsonLd,
  SoftwareApplicationJsonLd,
  WebSiteJsonLd,
} from "@/components/seo/json-ld"
import { GoogleAnalytics } from "@/components/seo/google-analytics"

const inter = Inter({ subsets: ["latin"] })

const siteUrl = "https://stapp.com.ar"

function extractSubdomain(hostname: string): string | null {
  const host = hostname.split(":")[0]
  if (host === "localhost" || host === "127.0.0.1") return null

  if (host.endsWith(".local")) {
    const parts = host.split(".")
    if (parts.length >= 2 && parts[0] !== "stapp" && parts[0] !== "www") {
      return parts[0]
    }
    return null
  }

  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"
  const rootParts = rootDomain.split(".").length
  const parts = host.split(".")

  if (parts.length <= rootParts) return null
  const subdomain = parts[0]
  if (subdomain === "www") return null

  return subdomain
}

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "STApp - Gestión de Servicio Técnico",
    template: "%s | STApp",
  },
  // "facturación", no "facturación electrónica": STApp factura con numeración
  // automática e IVA discriminado y exporta a PDF, pero no tiene integración
  // con AFIP. Esta description es el snippet que se ve en Google, así que la
  // promesa se cumple tal cual está escrita.
  description: "Software #1 de gestión para talleres de reparación de celulares y servicio técnico. Órdenes de trabajo, clientes, inventario, facturación y notificaciones WhatsApp. Probá 30 días gratis.",
  keywords: [
    "software servicio técnico",
    "gestión taller reparación",
    "reparación celulares",
    "software reparaciones",
    "orden de trabajo",
    "gestión técnicos",
    "programa para taller de celulares",
    "sistema servicio técnico online",
    "software taller reparación celulares",
    "control inventario repuestos",
    "facturación electrónica taller",
    "gestión órdenes de reparación",
    "software gestión taller electrónica",
    "sistema de órdenes de trabajo",
    "app servicio técnico",
  ],
  authors: [{ name: "STApp" }],
  creator: "STApp",
  publisher: "STApp",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "32x32" },
    ],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "STApp",
  },
  // Open Graph
  openGraph: {
    type: "website",
    locale: "es_AR",
    url: siteUrl,
    siteName: "STApp",
    title: "STApp - Gestión de Servicio Técnico",
    description: "Sistema de gestión para servicio técnico de dispositivos electrónicos. Administra órdenes de trabajo, clientes, inventario y facturación.",
    images: [
      {
        url: "/api/og?v=3",
        width: 1200,
        height: 630,
        alt: "STApp - Software de Gestión para Talleres de Reparación de Celulares",
      },
    ],
  },
  // Twitter Cards
  twitter: {
    card: "summary_large_image",
    title: "STApp - Gestión de Servicio Técnico",
    description: "Sistema de gestión para servicio técnico de dispositivos electrónicos. Administra órdenes, clientes e inventario.",
    images: ["/api/og?v=3"],
  },
  // Robots
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  // Alternates con hreflang para pa\u00edses hispanohablantes
  alternates: {
    canonical: siteUrl,
    languages: {
      "es-AR": siteUrl,
      "es": siteUrl,
      "x-default": siteUrl,
    },
  },
  // Search Console. Se resuelve por variable de entorno para que activarlo no
  // requiera tocar codigo: alcanza con setear GOOGLE_SITE_VERIFICATION en
  // Vercel y redeployar. Si no esta seteada, Next omite la meta tag entera.
  //
  // Nota: verificar el dominio por DNS en Search Console no necesita esta meta
  // tag en absoluto, y cubre el dominio completo incluidos los subdominios de
  // tenant. Esta via es la alternativa para cuando se verifica por prefijo de
  // URL.
  verification: process.env.GOOGLE_SITE_VERIFICATION
    ? { google: process.env.GOOGLE_SITE_VERIFICATION }
    : undefined,
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a1a" },
  ],
}

// Script to prevent flash of incorrect theme
const themeScript = `
  (function() {
    try {
      var theme = localStorage.getItem('theme');
      var systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

      if (theme === 'dark' || (!theme && systemDark)) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    } catch (e) {}
  })();
`

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const headersList = await headers()
  const hostname = headersList.get("host") || ""
  const subdomain = extractSubdomain(hostname)
  const isTenant = !!subdomain && subdomain !== "admin"
  // El catálogo público define su propio manifest por slug en /catalogo/[slug]/manifest.webmanifest
  // (vía Metadata API). Evitamos inyectar el manifest STApp ahí para no duplicar.
  const pathname = headersList.get("x-pathname") || headersList.get("next-url") || ""
  const isCatalogPath = pathname.startsWith("/catalogo/")

  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        {/* Manifest solo en subdominios de tenant (PWA instalable), no en catálogo público */}
        {isTenant && !isCatalogPath && <link rel="manifest" href="/manifest.json" />}

        {/* Open Search Description */}
        <link
          rel="search"
          type="application/opensearchdescription+xml"
          title="STApp"
          href="/opensearch.xml"
        />

        {/* Preload de recursos cr\u00edticos */}
        <link rel="preconnect" href="https://images.unsplash.com" />
        <link rel="dns-prefetch" href="https://images.unsplash.com" />
        <link rel="preconnect" href="https://www.googletagmanager.com" />
        <link rel="dns-prefetch" href="https://www.googletagmanager.com" />

        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="STApp" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="apple-touch-icon" sizes="152x152" href="/apple-touch-icon.png" />
        <link rel="apple-touch-icon" sizes="144x144" href="/apple-touch-icon.png" />
        <link rel="apple-touch-icon" sizes="120x120" href="/apple-touch-icon.png" />

        {/* Optimizaciones móviles adicionales */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="format-detection" content="telephone=no" />
        <meta name="HandheldFriendly" content="true" />
        <meta name="MobileOptimized" content="width" />

        <Script
          id="theme-script"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />

        {/* Schema Markup JSON-LD */}
        <OrganizationJsonLd />
        <SoftwareApplicationJsonLd />
        <WebSiteJsonLd />

        {/* Google Analytics */}
        <GoogleAnalytics />
      </head>
      <body className={inter.className}>
        <Providers>
          {children}
          {/* PWA solo en subdominios de tenant */}
          {isTenant && <PWAUpdater />}
          {isTenant && <PWAInstaller />}
          {isTenant && <PWARecovery />}
          <CookieConsent />
        </Providers>
      </body>
    </html>
  )
}
