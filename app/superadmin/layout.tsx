import { redirect } from "next/navigation"
import { getSuperadminSession } from "@/lib/superadmin-auth"
import { NavbarSuperadmin } from "@/components/superadmin/navbar-superadmin"
import { SkipLinks } from "@/components/shared/skip-links"

// Forzar renderizado dinámico para verificar auth en cada navegación
export const dynamic = "force-dynamic"

export default async function SuperadminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getSuperadminSession()

  if (!session) {
    redirect("/superadmin-login")
  }

  return (
    <div className="min-h-screen bg-muted/30 dark:bg-background">
      <SkipLinks />
      <NavbarSuperadmin userEmail={session.user?.email || ""} />
      <main id="main-content" className="lg:pl-64 pt-[calc(3.5rem+env(safe-area-inset-top,0px))] lg:pt-0">
        <div className="p-4 lg:p-8">{children}</div>
      </main>
    </div>
  )
}
