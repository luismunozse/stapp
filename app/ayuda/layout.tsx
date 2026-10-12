import type { Metadata } from "next"
import { OG_IMAGES } from "@/lib/og/metadata"

export const metadata: Metadata = {
  title: "Centro de Ayuda - STApp",
  description:
    "Encontrá respuestas a tus preguntas sobre STApp. Guías, preguntas frecuentes y soporte para gestionar tu taller de reparación de dispositivos electrónicos.",
  keywords: [
    "ayuda STApp",
    "centro de ayuda",
    "soporte técnico",
    "preguntas frecuentes",
    "FAQ STApp",
    "guía de uso",
    "servicio técnico",
  ],
  openGraph: {
    images: OG_IMAGES,
    title: "Centro de Ayuda - STApp",
    description:
      "Encontrá respuestas a tus preguntas sobre STApp. Guías, preguntas frecuentes y soporte.",
    url: "https://stapp.com.ar/ayuda",
  },
  alternates: {
    canonical: "https://stapp.com.ar/ayuda",
  },
}

export default function AyudaLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
