import { ClientesList } from "@/components/clientes/clientes-list"

export default function ClientesPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Clientes</h1>
          <p className="text-muted-foreground">
            Gestiona tus clientes y su información
          </p>
        </div>
      </div>
      <ClientesList />
    </div>
  )
}

