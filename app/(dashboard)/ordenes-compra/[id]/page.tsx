import { OrdenCompraDetalle } from "@/components/ordenes-compra/orden-compra-detalle"
import { PageShell } from "@/components/ui/page-shell"

export default async function OrdenCompraDetallePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  return (
    <PageShell
      title="Orden de compra"
      description="Detalle de la orden y avance de la recepción"
      backHref="/ordenes-compra"
    >
      <OrdenCompraDetalle ordenCompraId={id} />
    </PageShell>
  )
}
