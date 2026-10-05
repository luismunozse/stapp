import { auth } from "@/lib/auth"
import { hasPlanFeature } from "@/lib/subscriptions"
import { ClienteDetalle } from "@/components/clientes/detalle/cliente-detalle"

export default async function ClienteDetallePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await auth()
  const canReparacionesExpress = session?.user?.organizationId
    ? await hasPlanFeature(session.user.organizationId, "reparaciones_express")
    : false

  return <ClienteDetalle clienteId={id} canReparacionesExpress={canReparacionesExpress} />
}
