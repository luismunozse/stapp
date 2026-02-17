import { VendedoresList } from "@/components/vendedores/vendedores-list"

export default function VendedoresPage() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Vendedores</h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Gestiona los vendedores de tu organización
        </p>
      </div>
      <VendedoresList />
    </div>
  )
}
