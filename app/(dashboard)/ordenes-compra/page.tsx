import { OrdenesCompraList } from "@/components/ordenes-compra/ordenes-compra-list"
import { PageShell } from "@/components/ui/page-shell"

export default function OrdenesCompraPage() {
  return (
    <PageShell title="Órdenes de Compra" description="Gestiona las órdenes de compra a proveedores y recepción de mercadería">
      <OrdenesCompraList />
    </PageShell>
  )
}
