import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Subir fotos | STApp",
  description: "Subí fotos a la orden desde el celular",
  robots: { index: false, follow: false },
  // El token va en la URL: que no viaje como referer a ningún lado.
  referrer: "no-referrer",
}

export default function SubirFotosLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-gradient-to-b from-muted/50 to-background">
      <main className="container mx-auto px-4 py-6 max-w-md">{children}</main>
    </div>
  )
}
