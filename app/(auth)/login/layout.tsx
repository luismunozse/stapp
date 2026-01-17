import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Iniciar Sesión",
  description:
    "Accede a tu cuenta de STApp para gestionar tu taller de reparación. Administra órdenes, clientes e inventario.",
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: "Iniciar Sesión - STApp",
    description: "Accede a tu cuenta de STApp para gestionar tu taller de reparación.",
    url: "https://stapp.com.ar/login",
  },
  alternates: {
    canonical: "https://stapp.com.ar/login",
  },
}

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
