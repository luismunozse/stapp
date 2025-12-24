import { OrdenesList } from "@/components/ordenes/ordenes-list"

export default function OrdenesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Órdenes de Servicio</h1>
        <p className="text-muted-foreground">
          Gestiona las órdenes de servicio y su estado
        </p>
      </div>
      <OrdenesList />
    </div>
  )
}

