import { OrdenesList } from "@/components/ordenes/ordenes-list"
import { PageShell } from "@/components/ui/page-shell"

export default function OrdenesPage() {
  return (
    <PageShell
      title="Órdenes de Servicio"
      description="Gestiona las órdenes de servicio y su estado"
    >
      <OrdenesList />
    </PageShell>
  )
}
