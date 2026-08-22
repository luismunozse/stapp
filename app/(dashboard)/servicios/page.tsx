import { ServiciosClient } from "@/components/servicios/servicios-client"
import { PageShell } from "@/components/ui/page-shell"

export default function ServiciosPage() {
  return (
    <PageShell title="Servicios" description="Catálogo de servicios que ofrece el taller">
      <ServiciosClient />
    </PageShell>
  )
}
