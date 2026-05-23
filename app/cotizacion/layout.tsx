import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Cotizacion | STApp",
  description: "Presupuesto de servicio tecnico",
  robots: { index: false, follow: false },
}

export default function CotizacionPublicLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-dvh bg-muted/30">
      <main className="container mx-auto px-4 py-8 max-w-2xl">
        {children}
      </main>
    </div>
  )
}
