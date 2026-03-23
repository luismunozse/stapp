import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { getSubscriptionInfo, hasValidAccess, getTrialInfo } from "@/lib/subscriptions"
import { SubscriptionRequiredView } from "@/components/subscription/subscription-required-view"

export const dynamic = "force-dynamic"

interface PageProps {
  searchParams: Promise<{ reason?: string }>
}

export default async function SubscripcionRequeridaPage({ searchParams }: PageProps) {
  const session = await auth()

  if (!session) {
    redirect("/login")
  }

  const organizationId = session.user.organizationId
  const { hasAccess } = await hasValidAccess(organizationId)
  const subscription = await getSubscriptionInfo(organizationId)
  const trialInfo = await getTrialInfo(organizationId)
  const { reason } = await searchParams

  return (
    <SubscriptionRequiredView
      reason={reason as "trial_expired" | "canceled" | "past_due" | undefined}
      planNombre={subscription?.planNombre}
      hasAccess={hasAccess}
      daysRemaining={trialInfo.daysRemaining}
    />
  )
}
