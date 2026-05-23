import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Seguimiento de Orden | STApp",
  description: "Consulta el estado de tu orden de servicio",
  robots: { index: false, follow: false },
}

export default function SeguimientoLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-dvh bg-gradient-to-b from-muted/50 to-background">
      <main className="container mx-auto px-4 py-6 sm:py-10 max-w-lg">
        {children}
      </main>
    </div>
  )
}
