import { VentaDetail } from "@/components/ventas/venta-detail"

export default async function VentaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <div className="container py-6">
      <VentaDetail ventaId={id} />
    </div>
  )
}
