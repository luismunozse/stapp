import { FacturacionList } from "@/components/facturacion/facturacion-list"

export default function FacturacionPage() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Facturación</h1>
        <p className="text-sm text-muted-foreground">
          Gestiona las facturas y pagos
        </p>
      </div>
      <FacturacionList />
    </div>
  )
}

