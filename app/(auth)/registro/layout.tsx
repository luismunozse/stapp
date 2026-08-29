import type { Metadata } from "next"
import { OG_IMAGES } from "@/lib/og/metadata"

export const metadata: Metadata = {
  title: "Crear Cuenta Gratis",
  description:
    "Registra tu taller de reparación en STApp. Comienza gratis y gestiona órdenes de trabajo, clientes, inventario y facturación.",
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
    title: "Crear Cuenta Gratis - STApp",
    description:
      "Registra tu taller de reparación en STApp. Comienza gratis.",
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
