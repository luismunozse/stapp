import { ProveedoresList } from "@/components/proveedores/proveedores-list"

export default function ProveedoresPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Proveedores</h1>
        <p className="text-muted-foreground mt-1">
          Gestiona los proveedores mayoristas y actualiza los precios
        </p>
      </div>
      <ProveedoresList />
    </div>
  )
}
