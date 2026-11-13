import type { Metadata } from "next"
import { OG_IMAGES } from "@/lib/og/metadata"

export const metadata: Metadata = {
  title: "Crear cuenta gratis",
  description:
    "Registrá tu taller de reparación en STApp. Empezá gratis y gestioná órdenes de trabajo, clientes, inventario y facturación.",
  keywords: [
    "registrar taller",
    "crear cuenta servicio técnico",
    "software gratis reparaciones",
    "gestión taller gratis",
  ],
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    images: OG_IMAGES,
    title: "Crear cuenta gratis - STApp",
    description:
      "Registrá tu taller de reparación en STApp. Empezá gratis.",
    url: "https://stapp.com.ar/registro",
  },
  alternates: {
    canonical: "https://stapp.com.ar/registro",
  },
}

export default function RegistroLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
