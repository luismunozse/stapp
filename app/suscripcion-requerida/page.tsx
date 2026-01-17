import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { getSubscriptionInfo, hasValidAccess } from "@/lib/subscriptions"
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

  // Verificar si realmente no tiene acceso (por si llegaron aquí por error)
  const { hasAccess } = await hasValidAccess(organizationId)

  if (hasAccess) {
    redirect("/dashboard")
  }

  const subscription = await getSubscriptionInfo(organizationId)
  const { reason } = await searchParams

  return (
    <SubscriptionRequiredView
      reason={reason as "trial_expired" | "canceled" | "past_due" | undefined}
      planNombre={subscription?.planNombre}
    />
  )
}
