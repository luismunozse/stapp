import { VendedoresList } from "@/components/vendedores/vendedores-list"

export default function VendedoresPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Vendedores</h1>
        <p className="text-muted-foreground">
          Gestiona los vendedores de tu organización
        </p>
      </div>
      <VendedoresList />
    </div>
  )
}
