import { redirect } from "next/navigation"
import { requireAuth } from "@/lib/auth-utils"
import { isPremium } from "@/lib/subscriptions"
import { ReportesAvanzadosView } from "@/components/reportes-avanzados/reportes-avanzados-view"
import { FeatureLockedView } from "@/components/billing/feature-locked-view"

export const dynamic = "force-dynamic"

export default async function ReportesAvanzadosPage() {
  const { error, organizationId } = await requireAuth()

  if (error || !organizationId) {
    redirect("/login")
  }

  const premium = await isPremium(organizationId)

  if (!premium) {
    return (
      <div className="container py-8">
        <FeatureLockedView
          featureName="Reportes avanzados"
          description="Detectá patrones de falla, tiempos de reparación y rentabilidad por técnico — datos que tu plan Free no expone."
          benefits={[
            "Tiempo de reparación por tipo de equipo y técnico",
            "Tasa de retorno y fallas más comunes",
            "Rentabilidad por orden y predicción de repuestos",
            "Performance de vendedores y comisiones consolidadas",
          ]}
          upgradeKey="reportes-avanzados"
        />
      </div>
    )
  }

  return (
    <div className="container py-6">
      <ReportesAvanzadosView />
    </div>
  )
}
