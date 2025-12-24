import { InventarioList } from "@/components/inventario/inventario-list"

export default function InventarioPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Inventario</h1>
        <p className="text-muted-foreground">
          Gestiona el stock de repuestos y componentes
        </p>
      </div>
      <InventarioList />
    </div>
  )
}

