import { auth } from "@/lib/auth"
import { OrdenesList } from "@/components/ordenes/ordenes-list"
import { PageShell } from "@/components/ui/page-shell"
import { hasPlanFeature } from "@/lib/subscriptions"

export default async function OrdenesPage() {
  const session = await auth()
  const canRecepcionMultiple = session?.user?.organizationId
    ? await hasPlanFeature(session.user.organizationId, "recepcion_multiple")
    : false

  return (
    <PageShell
      title="Órdenes de Servicio"
      description="Gestiona las órdenes de servicio y su estado"
    >
      <OrdenesList canRecepcionMultiple={canRecepcionMultiple} />
    </PageShell>
  )
}
