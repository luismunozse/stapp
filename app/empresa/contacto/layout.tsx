import type { Metadata } from "next"
import { LocalBusinessJsonLd, BreadcrumbJsonLd } from "@/components/seo/json-ld"

export const metadata: Metadata = {
  title: "Contacto - Soporte para Software de Servicio T\u00e9cnico",
  description:
    "Contacta con el equipo de STApp. Soporte t\u00e9cnico, consultas comerciales y ayuda para nuestro software de gesti\u00f3n de talleres de reparaci\u00f3n. Respuesta r\u00e1pida por email, tel\u00e9fono o WhatsApp.",
  keywords: [
    "contacto STApp",
    "soporte t\u00e9cnico software reparaciones",
    "atenci\u00f3n al cliente taller",
    "ayuda gesti\u00f3n taller reparaci\u00f3n",
    "soporte software servicio t\u00e9cnico",
  ],
  openGraph: {
    title: "Contacto - STApp Software de Servicio T\u00e9cnico",
    description:
      "Contacta con el equipo de STApp. Soporte por email, tel\u00e9fono y WhatsApp para tu taller de reparaci\u00f3n.",
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
