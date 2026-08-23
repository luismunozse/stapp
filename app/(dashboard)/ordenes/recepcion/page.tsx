import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { hasPlanFeature } from "@/lib/subscriptions"
import { FeatureLockedView } from "@/components/billing/feature-locked-view"
import { PageShell } from "@/components/ui/page-shell"
import { RecepcionForm } from "@/components/ordenes/recepcion-form"
import { getTerminologia } from "@/lib/terminologia-server"
import { t } from "@/lib/terminologia"

export default async function RecepcionMultiplePage() {
  const session = await auth()
  if (!session) redirect("/login")

  const [canRecepcionMultiple, term] = await Promise.all([
    hasPlanFeature(session.user.organizationId, "recepcion_multiple"),
    getTerminologia(session.user.organizationId),
  ])

  const equipos = t(term, "equipoPlural").toLowerCase()
  const equipo = t(term, "equipo").toLowerCase()

  if (!canRecepcionMultiple) {
    return (
      <div className="py-8 px-4">
        <FeatureLockedView
          featureName={`Recepción de varios ${equipos}`}
          description={`Recibí todos los ${equipos} que trae un cliente en una sola atención, con un comprobante y una firma.`}
          benefits={[
            `Cargar varios ${equipos} sin volver a tipear los datos del cliente`,
            `Un comprobante con todos los ${equipos} y una sola firma`,
            `Una orden por ${equipo}, cada una con su seguimiento y su etiqueta`,
          ]}
        />
      </div>
    )
  }

  return (
    <PageShell
      title={`Recibir varios ${equipos}`}
      description={`Cargá todos los ${equipos} que trae el cliente en una sola atención`}
    >
      <RecepcionForm />
    </PageShell>
  )
}
