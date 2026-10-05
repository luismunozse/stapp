import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { hasPlanFeature } from "@/lib/subscriptions"
import { FeatureLockedView } from "@/components/billing/feature-locked-view"
import { RecepcionDetail } from "@/components/ordenes/recepcion-detail"

export default async function RecepcionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await auth()
  if (!session) redirect("/login")

  const canRecepcionMultiple = await hasPlanFeature(
    session.user.organizationId,
    "recepcion_multiple",
  )

  if (!canRecepcionMultiple) {
    return (
      <div className="py-8 px-4">
        <FeatureLockedView
          featureName="Recepción múltiple"
          description="Gestioná lotes de equipos con precio mayorista"
          benefits={[
            "Carga N equipos en una sola recepción",
            "Descuento sobre el total del lote",
            "Entrega y cobro del lote en una sola operación",
          ]}
        />
      </div>
    )
  }

  return <RecepcionDetail recepcionId={id} />
}
