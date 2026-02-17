import { ProveedoresList } from "@/components/proveedores/proveedores-list"

export default function ProveedoresPage() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Proveedores</h1>
        <p className="text-sm sm:text-base text-muted-foreground mt-1">
          Gestiona los proveedores y actualiza precios
        </p>
      </div>
      <ProveedoresList />
    </div>
  )
}
