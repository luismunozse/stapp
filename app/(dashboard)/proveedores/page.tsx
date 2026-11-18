import { ProveedoresList } from "@/components/proveedores/proveedores-list"
import { PageShell } from "@/components/ui/page-shell"

export default function ProveedoresPage() {
  return (
    <PageShell title="Proveedores" description="Gestioná los proveedores y actualizá precios">
      <ProveedoresList />
    </PageShell>
  )
}
