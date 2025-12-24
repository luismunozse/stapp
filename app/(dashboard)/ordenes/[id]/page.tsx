import { OrdenDetail } from "@/components/ordenes/orden-detail"

export default async function OrdenDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <OrdenDetail ordenId={id} />
}

