import { OrdenesCompraList } from "@/components/ordenes-compra/ordenes-compra-list"
import { PageShell } from "@/components/ui/page-shell"

export default function OrdenesCompraPage() {
  return (
    <PageShell title="Órdenes de compra" description="Gestioná las órdenes de compra a proveedores y la recepción de mercadería">
      <OrdenesCompraList />
    </PageShell>
  )
}
