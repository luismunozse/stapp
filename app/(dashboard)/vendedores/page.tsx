import { VendedoresList } from "@/components/vendedores/vendedores-list"
import { PageShell } from "@/components/ui/page-shell"

export default function VendedoresPage() {
  return (
    <PageShell title="Vendedores" description="Gestioná los vendedores de tu organización">
      <VendedoresList />
    </PageShell>
  )
}
