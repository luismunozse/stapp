import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { PWAInstaller } from "@/components/pwa/pwa-installer"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Servicio Técnico - Gestión",
  description: "Sistema de gestión para servicio técnico de celulares y computadoras",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Servicio Técnico",
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#3b82f6",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#3b82f6" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Servicio Técnico" />
      </head>
      <body className={inter.className}>
        {children}
        <PWAInstaller />
      </body>
    </html>
  )
}
