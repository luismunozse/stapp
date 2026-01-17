import { redirect } from "next/navigation"
import { requireAuth } from "@/lib/auth-utils"
import { isPremium } from "@/lib/subscriptions"
import { ReportesAvanzadosView } from "@/components/reportes-avanzados/reportes-avanzados-view"

export const dynamic = "force-dynamic"

export default async function ReportesAvanzadosPage() {
  const { error, organizationId } = await requireAuth()

  if (error || !organizationId) {
    redirect("/login")
  }

  // Verificar si es Premium
  const premium = await isPremium(organizationId)

  if (!premium) {
    // Redirigir a billing con mensaje
    redirect("/configuracion/billing?upgrade=reportes-avanzados")
  }

  return (
    <div className="container py-6">
      <ReportesAvanzadosView />
    </div>
  )
}
