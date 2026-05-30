import type { Metadata } from "next"
import { ThemeToggle } from "@/components/ui/theme-toggle"

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
      <div className="fixed top-3 right-3 z-50">
        <ThemeToggle className="bg-background/70 backdrop-blur-sm border border-border/50 rounded-full shadow-sm" />
      </div>
      <main className="container mx-auto px-4 py-6 sm:py-10 max-w-lg">
        {children}
      </main>
    </div>
  )
}
