import { ClientesList } from "@/components/clientes/clientes-list"
import { canImportData } from "@/lib/auth-utils"

export default async function ClientesPage() {
  const allowImport = await canImportData()

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
      <ClientesList allowImport={allowImport} />
    </div>
  )
}

