import { FacturacionList } from "@/components/facturacion/facturacion-list"
import { PageShell } from "@/components/ui/page-shell"

export default function FacturacionPage() {
  return (
    <PageShell title="Facturación" description="Gestiona las facturas y pagos">
      <FacturacionList />
    </PageShell>
  )
}

