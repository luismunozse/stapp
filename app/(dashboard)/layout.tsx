import { Navbar } from "@/components/layout/navbar"
import { SidebarProvider } from "@/components/layout/sidebar-context"
import { SidebarMain } from "@/components/layout/sidebar-main"
import { TrialBanner } from "@/components/subscription/trial-banner"
import { PolicyChangeModal } from "@/components/subscription/policy-change-modal"
import { SkipLinks } from "@/components/shared/skip-links"
import { ApkDownloadBanner } from "@/components/shared/apk-download-banner"
import { MaintenanceBanner } from "@/components/shared/maintenance-banner"
import { SampleDataBannerWrapper } from "@/components/onboarding/sample-data-banner-wrapper"
import { GuidedTour } from "@/components/guided-tour"
import { OfflineProvider } from "@/contexts/offline-context"
import { OfflineBanner } from "@/components/offline/offline-banner"
import { SyncStatusIndicator } from "@/components/offline/sync-status-indicator"
import { auth } from "@/lib/auth"
import { isSuperadminEmail } from "@/lib/superadmin-auth"
import { hasValidAccess, getTrialInfo, getSubscriptionInfo } from "@/lib/subscriptions"
import { supabaseAdmin } from "@/lib/supabase"
import { redirect } from "next/navigation"
import { unstable_cache } from "next/cache"
import { connection } from "next/server"

// Cachear verificación de acceso por 1 minuto para mejorar performance
const getCachedAccessInfo = unstable_cache(
  async (organizationId: string) => {
    const [accessResult, trialInfo, subscription] = await Promise.all([
      hasValidAccess(organizationId),
      getTrialInfo(organizationId),
      getSubscriptionInfo(organizationId),
    ])
    return { accessResult, trialInfo, planNombre: subscription?.planNombre || "Profesional" }
  },
  ["access-info", "by-org"],
  { revalidate: 60, tags: ["subscription"] }
)

// Query directo sin cache — es un single-row lookup por PK, ultra rápido
async function getMaintenanceBanner() {
  await connection()
  const { data } = await supabaseAdmin
    .from("maintenance_banner")
    .select("active, message, severity")
    .eq("id", "global")
    .maybeSingle()
  return data
}

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

  // Superadmin siempre tiene acceso (no depende de suscripción)
  const superadmin = isSuperadminEmail(session.user.email)

  // Verificar acceso válido con caché (trial no expirado o suscripción activa)
  const { accessResult, trialInfo, planNombre } = await getCachedAccessInfo(organizationId)

  if (!accessResult.hasAccess && !superadmin) {
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

  // Banner de mantenimiento global (gestionado por superadmin)
  const maintenanceBanner = await getMaintenanceBanner()
  const showMaintenanceBanner =
    !!maintenanceBanner?.active && !!maintenanceBanner?.message?.trim()

  return (
    <SidebarProvider>
      <OfflineProvider>
        <div className="min-h-screen bg-muted/30 dark:bg-background">
          <SkipLinks />
          <OfflineBanner />
          <Navbar />
          {/* Banner de mantenimiento (gestionado por superadmin) */}
          {showMaintenanceBanner && maintenanceBanner && (
            <MaintenanceBanner
              message={maintenanceBanner.message}
              severity={maintenanceBanner.severity as "INFO" | "WARNING" | "CRITICAL"}
            />
          )}
          {/* Banner de trial si está en período de prueba */}
          {!showMaintenanceBanner && showTrialBanner && (
            <TrialBanner daysRemaining={trialInfo.daysRemaining} planNombre={planNombre} />
          )}
          {/* Banner de datos de ejemplo */}
          {hasSampleData && <SampleDataBannerWrapper />}
          {/* Banner de descarga APK para móvil (no se muestra en app nativa) */}
          {!showMaintenanceBanner && !showTrialBanner && !hasSampleData && <ApkDownloadBanner variant="top" />}
          <SidebarMain
            className={
              showMaintenanceBanner || showTrialBanner
                ? "pt-[calc(3.5rem+2.5rem+env(safe-area-inset-top,0px))] lg:pt-10"
                : "pt-[calc(3.5rem+env(safe-area-inset-top,0px))] lg:pt-0"
            }
          >
            {children}
          </SidebarMain>
          {/* Modal de cambio de políticas - se muestra una sola vez */}
          {showTrialBanner && (
            <PolicyChangeModal daysRemaining={trialInfo.daysRemaining} />
          )}
          {/* Tour guiado - se muestra automáticamente la primera vez */}
          <GuidedTour />
          {/* Indicador de operaciones offline pendientes */}
          <SyncStatusIndicator />
        </div>
      </OfflineProvider>
    </SidebarProvider>
  )
}
