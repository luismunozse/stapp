import { InventarioList } from "@/components/inventario/inventario-list"
import { canImportData } from "@/lib/auth-utils"

export default async function InventarioPage() {
  const allowImport = await canImportData()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Inventario</h1>
        <p className="text-muted-foreground">
          Gestiona el stock de repuestos, accesorios y productos
        </p>
      </div>
      <InventarioList allowImport={allowImport} />
    </div>
  )
}

