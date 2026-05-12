import { ProveedorDetail } from "@/components/proveedores/proveedor-detail"

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function ProveedorDetailPage({ params }: PageProps) {
  const { id } = await params
  return <ProveedorDetail proveedorId={id} />
}
