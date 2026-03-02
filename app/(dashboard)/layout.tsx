import { Navbar } from "@/components/layout/navbar"
import { TrialBanner } from "@/components/subscription/trial-banner"
import { PolicyChangeModal } from "@/components/subscription/policy-change-modal"
import { SkipLinks } from "@/components/shared/skip-links"
import { ApkDownloadBanner } from "@/components/shared/apk-download-banner"
import { SampleDataBannerWrapper } from "@/components/onboarding/sample-data-banner-wrapper"
import { GuidedTour } from "@/components/guided-tour"
import { auth } from "@/lib/auth"
import { hasValidAccess, getTrialInfo } from "@/lib/subscriptions"
import { supabaseAdmin } from "@/lib/supabase"
import { redirect } from "next/navigation"
import { unstable_cache } from "next/cache"

// Cachear verificación de acceso por 5 minutos para mejorar performance
const getCachedAccessInfo = unstable_cache(
  async (organizationId: string) => {
    const [accessResult, trialInfo] = await Promise.all([
      hasValidAccess(organizationId),
      getTrialInfo(organizationId),
    ])
    return { accessResult, trialInfo }
  },
  ["access-info"],
  { revalidate: 300, tags: ["subscription"] }
)

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

  // Verificar acceso válido con caché (trial no expirado o suscripción activa)
  const { accessResult, trialInfo } = await getCachedAccessInfo(organizationId)

  if (!accessResult.hasAccess) {
    // Redirigir a página de trial expirado/bloqueo
    redirect(`/suscripcion-requerida?reason=${accessResult.reason || "trial_expired"}`)
  }

  // Verificar si tiene datos de ejemplo
  const { data: orgData } = await supabaseAdmin
    .from("organizations")
    .select("has_sample_data, onboarding_completed")
    .eq("id", organizationId)
    .single()

  const hasSampleData = orgData?.has_sample_data || false
  const showTrialBanner = trialInfo.isInTrial && !trialInfo.isPaid

  return (
    <div className="min-h-screen bg-muted/30 dark:bg-background">
      <SkipLinks />
      <Navbar />
      {/* Banner de trial si está en período de prueba */}
      {showTrialBanner && (
        <TrialBanner daysRemaining={trialInfo.daysRemaining} />
      )}
      {/* Banner de datos de ejemplo */}
      {hasSampleData && <SampleDataBannerWrapper />}
      {/* Banner de descarga APK para móvil (no se muestra en app nativa) */}
      {!showTrialBanner && !hasSampleData && <ApkDownloadBanner variant="top" />}
      <main
        id="main-content"
        className={`lg:pl-64 pb-[calc(4rem+env(safe-area-inset-bottom,0px))] lg:pb-0 ${
          showTrialBanner
            ? "pt-[calc(3.5rem+2.5rem+env(safe-area-inset-top,0px))] lg:pt-10"
            : "pt-[calc(3.5rem+env(safe-area-inset-top,0px))] lg:pt-0"
        }`}
      >
        <div className="p-4 lg:p-8">{children}</div>
      </main>
      {/* Modal de cambio de políticas - se muestra una sola vez */}
      {showTrialBanner && (
        <PolicyChangeModal daysRemaining={trialInfo.daysRemaining} />
      )}
      {/* Tour guiado - se muestra automáticamente la primera vez */}
      <GuidedTour />
    </div>
  )
}
