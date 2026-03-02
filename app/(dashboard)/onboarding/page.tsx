import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard"

export default async function OnboardingPage() {
  const session = await auth()
  if (!session) redirect("/login")

  return <OnboardingWizard />
}
