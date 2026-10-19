import { ComprobantesTabs } from "@/components/facturacion/comprobantes-tabs"
import { PageShell } from "@/components/ui/page-shell"

export default function FacturacionPage() {
  return (
    <PageShell title="Comprobantes" description="Gestiona los remitos y pagos">
      <ComprobantesTabs />
    </PageShell>
  )
}

