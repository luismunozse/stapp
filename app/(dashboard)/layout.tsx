import { Navbar } from "@/components/layout/navbar"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"

// Forzar renderizado dinámico para verificar auth en cada navegación
export const dynamic = "force-dynamic"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  if (!session) {
    redirect("/login")
  }

  return (
    <div className="min-h-screen bg-muted/30 dark:bg-background">
      <Navbar />
      <main className="lg:pl-64 pt-16 lg:pt-0 pb-20 lg:pb-0">
        <div className="p-4 lg:p-8">{children}</div>
      </main>
    </div>
  )
}
