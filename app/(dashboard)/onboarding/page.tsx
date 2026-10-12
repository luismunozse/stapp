import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { OnboardingWizard } from "@/components/onboarding/wizard/onboarding-wizard"
import { loadOnboardingWizardProps } from "./wizard-props"

// The wizard's router.refresh() after a rubro change must re-read the org.
export const dynamic = "force-dynamic"

export default async function OnboardingPage() {
  const session = await auth()
  if (!session) redirect("/login")
  // Every request the wizard makes is ADMIN-only; other roles have nothing to do here.
  if (session.user.role !== "ADMIN") redirect("/dashboard")

  const props = await loadOnboardingWizardProps({
    organizationId: session.user.organizationId,
    userId: session.user.id,
    fallbackNombre: session.user.name ?? "",
    fallbackEmail: session.user.email ?? "",
  })

  return <OnboardingWizard {...props} />
}
