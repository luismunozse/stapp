import type { Metadata } from "next"

// This route renders a client component, which cannot export metadata, so the
// metadata lives in this pass-through layout.
//
// Unlike the internal screens, this page IS meant to rank: it is listed in
// sitemap.ts. It needs its own canonical, because without one it inherits
// `alternates.canonical` from the root layout, declares the home page as its
// canonical version, and can never be indexed.
export const metadata: Metadata = {
  title: "Descargar la app para Android",
  description:
    "Descargá STApp para Android e instalá la app en tu celular. Requiere Android 8.0 o superior. Gestioná las órdenes, los clientes y el inventario de tu taller desde el teléfono.",
  keywords: [
    "descargar stapp android",
    "app servicio técnico android",
    "apk gestión taller",
    "app taller reparación celulares",
    "software servicio técnico celular",
  ],
  openGraph: {
    title: "STApp para Android",
    description:
      "Instalá STApp en tu celular y gestioná tu taller desde donde estés. Compatible con Android 8.0 o superior.",
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
