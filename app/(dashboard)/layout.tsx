import { Navbar } from "@/components/layout/navbar"
import { TrialBanner } from "@/components/subscription/trial-banner"
import { PolicyChangeModal } from "@/components/subscription/policy-change-modal"
import { auth } from "@/lib/auth"
import { hasValidAccess, getTrialInfo } from "@/lib/subscriptions"
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

  const organizationId = session.user.organizationId

  // Verificar acceso válido (trial no expirado o suscripción activa)
  const { hasAccess, reason } = await hasValidAccess(organizationId)

  if (!hasAccess) {
    // Redirigir a página de trial expirado/bloqueo
    redirect(`/suscripcion-requerida?reason=${reason || "trial_expired"}`)
  }

  // Obtener info del trial para mostrar banner
  const trialInfo = await getTrialInfo(organizationId)

  const showTrialBanner = trialInfo.isInTrial && !trialInfo.isPaid

  return (
    <div className="min-h-screen bg-muted/30 dark:bg-background">
      <Navbar />
      {/* Banner de trial si está en período de prueba */}
      {showTrialBanner && (
        <TrialBanner daysRemaining={trialInfo.daysRemaining} />
      )}
      <main className={`lg:pl-64 pb-[calc(4rem+env(safe-area-inset-bottom,0px))] lg:pb-0 ${
        showTrialBanner ? "pt-[calc(3.5rem+2.5rem)] lg:pt-10" : "pt-14 lg:pt-0"
      }`}>
        <div className="p-4 lg:p-8">{children}</div>
      </main>
      {/* Modal de cambio de políticas - se muestra una sola vez */}
      {showTrialBanner && (
        <PolicyChangeModal daysRemaining={trialInfo.daysRemaining} />
      )}
    </div>
  )
}
