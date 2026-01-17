import type { Metadata } from "next"
import { LocalBusinessJsonLd, BreadcrumbJsonLd } from "@/components/seo/json-ld"

export const metadata: Metadata = {
  title: "Contacto",
  description:
    "Contacta con el equipo de STApp. Estamos aquí para ayudarte con cualquier consulta sobre nuestro software de gestión para servicio técnico.",
  keywords: [
    "contacto STApp",
    "soporte técnico",
    "atención al cliente",
    "software reparaciones contacto",
  ],
  openGraph: {
    title: "Contacto - STApp",
    description:
      "Contacta con el equipo de STApp. Estamos aquí para ayudarte con cualquier consulta.",
    url: "https://stapp.com.ar/empresa/contacto",
  },
  alternates: {
    canonical: "https://stapp.com.ar/empresa/contacto",
  },
}

export default function ContactoLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <LocalBusinessJsonLd />
      <BreadcrumbJsonLd
        items={[
          { name: "Inicio", url: "https://stapp.com.ar" },
          { name: "Contacto", url: "https://stapp.com.ar/empresa/contacto" },
        ]}
      />
      {children}
    </>
  )
}
