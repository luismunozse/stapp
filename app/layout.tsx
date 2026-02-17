import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { PWAInstaller } from "@/components/pwa/pwa-installer"
import { PWARecovery } from "@/components/pwa/pwa-recovery"
import { Providers } from "@/components/providers"
import { CookieConsent } from "@/components/cookie-consent"
import {
  OrganizationJsonLd,
  SoftwareApplicationJsonLd,
  WebSiteJsonLd,
} from "@/components/seo/json-ld"

const inter = Inter({ subsets: ["latin"] })

const siteUrl = "https://stapp.com.ar"

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "STApp - Gestión de Servicio Técnico",
    template: "%s | STApp",
  },
  description: "Sistema de gestión para servicio técnico de dispositivos electrónicos. Administra órdenes de trabajo, clientes, inventario y facturación desde una sola plataforma.",
  keywords: ["servicio técnico", "gestión taller", "reparación celulares", "software reparaciones", "orden de trabajo", "gestión técnicos"],
  authors: [{ name: "STApp" }],
  creator: "STApp",
  publisher: "STApp",
  manifest: "/manifest.json",
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
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "STApp - Gestión de Servicio Técnico",
      },
    ],
  },
  // Twitter Cards
  twitter: {
    card: "summary_large_image",
    title: "STApp - Gestión de Servicio Técnico",
    description: "Sistema de gestión para servicio técnico de dispositivos electrónicos. Administra órdenes, clientes e inventario.",
    images: ["/og-image.png"],
    creator: "@stapp_ar",
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
  // Alternates
  alternates: {
    canonical: siteUrl,
  },
  // Verification (agregar IDs cuando estén disponibles)
  // verification: {
  //   google: "google-site-verification-id",
  // },
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
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

        {/* Preconnect para recursos externos */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />

        {/* DNS prefetch para APIs */}
        <link rel="dns-prefetch" href="https://fonts.googleapis.com" />

        <script dangerouslySetInnerHTML={{ __html: themeScript }} />

        {/* Schema Markup JSON-LD */}
        <OrganizationJsonLd />
        <SoftwareApplicationJsonLd />
        <WebSiteJsonLd />
      </head>
      <body className={inter.className}>
        <Providers>
          {children}
          <PWAInstaller />
          <PWARecovery />
          <CookieConsent />
        </Providers>
      </body>
    </html>
  )
}
