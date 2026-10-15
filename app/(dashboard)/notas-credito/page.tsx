import { NotasCreditoList } from "@/components/notas-credito/notas-credito-list"

// Solo ADMIN hasta el PR7: el middleware (lib/rutas-por-rol.ts) rebota al
// resto y GET /api/notas-credito responde 403.
interface NotasCreditoPageProps {
  searchParams: Promise<{ cliente?: string | string[] }>
}

export default async function NotasCreditoPage({ searchParams }: NotasCreditoPageProps) {
  const { cliente } = await searchParams
  const clienteId = typeof cliente === "string" && cliente.trim() ? cliente.trim() : null

  return (
    <div className="container space-y-6 py-6">
      <div>
        <h1 className="text-2xl font-bold">Notas de crédito</h1>
        <p className="text-sm text-muted-foreground">
          Las notas de crédito de ventas y órdenes, incluidas las anuladas y el historial de devoluciones.
        </p>
      </div>
      <NotasCreditoList clienteId={clienteId} />
    </div>
  )
}
