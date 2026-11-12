import { ComprobantesTabs } from "@/components/facturacion/comprobantes-tabs"
import { PageShell } from "@/components/ui/page-shell"

export default function FacturacionPage() {
  return (
    <PageShell title="Comprobantes" description="Remitos, pagos y facturas electrónicas ARCA">
      <ComprobantesTabs />
    </PageShell>
  )
}

