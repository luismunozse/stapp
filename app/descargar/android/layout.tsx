import type { Metadata } from "next"
import { OG_IMAGES } from "@/lib/og/metadata"

// Unlike the internal screens, this page IS meant to rank: it is listed in
// sitemap.ts. It needs its own canonical, because without one it inherits
// `alternates.canonical` from the root layout, declares the home page as its
// canonical version, and can never be indexed.
export const metadata: Metadata = {
  title: "Descargar la app para Android",
  description:
    "STApp para Android está en beta en Google Play. Creá tu cuenta, anotate desde el panel y recibí la invitación para instalarla. Requiere Android 8.0 o superior.",
  keywords: [
    "descargar stapp android",
    "app servicio técnico android",
    "app taller reparación celulares",
    "software servicio técnico celular",
  ],
  openGraph: {
    images: OG_IMAGES,
    title: "STApp para Android",
    description:
      "Sumate a la beta de STApp en Google Play y gestioná tu taller desde el celular. Compatible con Android 8.0 o superior.",
    url: "https://stapp.com.ar/descargar/android",
  },
  alternates: {
    canonical: "https://stapp.com.ar/descargar/android",
  },
}

export default function DescargarAndroidLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
