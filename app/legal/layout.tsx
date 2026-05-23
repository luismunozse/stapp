import { NavbarLanding } from "@/components/landing/navbar-landing"
import { Footer } from "@/components/landing/footer"

export default function LegalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-dvh flex flex-col">
      <NavbarLanding />
      <main className="flex-1 bg-muted/50">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="max-w-4xl mx-auto bg-card rounded-lg shadow-sm p-8 md:p-12">
            {children}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}
