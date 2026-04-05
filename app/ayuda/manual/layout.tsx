import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Manual de Uso - STApp",
  description:
    "Manual completo de uso de STApp. Aprendé a gestionar órdenes, inventario, clientes, facturación y más en tu taller de servicio técnico.",
  keywords: [
    "manual STApp",
    "guía de uso",
    "tutorial STApp",
    "servicio técnico",
    "gestión de taller",
  ],
  openGraph: {
    title: "Manual de Uso - STApp",
    description:
      "Manual completo de uso de STApp para gestionar tu taller de servicio técnico.",
    url: "https://stapp.com.ar/ayuda/manual",
  },
  alternates: {
    canonical: "https://stapp.com.ar/ayuda/manual",
  },
}

export default function ManualLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
