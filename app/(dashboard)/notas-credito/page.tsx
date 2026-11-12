import { NotasCreditoList } from "@/components/notas-credito/notas-credito-list"
import { PageShell } from "@/components/ui/page-shell"

// Solo ADMIN hasta el PR7: el middleware (lib/rutas-por-rol.ts) rebota al
// resto y GET /api/notas-credito responde 403.
interface NotasCreditoPageProps {
  searchParams: Promise<{ cliente?: string | string[] }>
}

export default async function NotasCreditoPage({ searchParams }: NotasCreditoPageProps) {
  const { cliente } = await searchParams
  const clienteId = typeof cliente === "string" && cliente.trim() ? cliente.trim() : null

  return (
    <PageShell
      title="Notas de crédito"
      description="Las notas de crédito de ventas y órdenes, incluidas las anuladas y el historial de devoluciones."
      className="container py-6"
    >
      <NotasCreditoList clienteId={clienteId} />
    </PageShell>
  )
}
