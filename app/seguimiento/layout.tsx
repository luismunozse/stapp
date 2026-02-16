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
    <div className="min-h-screen bg-muted/30">
      <main className="container mx-auto px-4 py-8 max-w-2xl">
        {children}
      </main>
    </div>
  )
}
