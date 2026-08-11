import { FacturacionList } from "@/components/facturacion/facturacion-list"
import { PageShell } from "@/components/ui/page-shell"

export default function FacturacionPage() {
  return (
    <PageShell title="Comprobantes" description="Gestiona los remitos y pagos">
      <FacturacionList />
    </PageShell>
  )
}

