import { AjustePreciosProveedor } from "@/components/proveedores/ajuste-precios-proveedor"

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function AjustePreciosPage({ params }: PageProps) {
  const { id } = await params
  return <AjustePreciosProveedor proveedorId={id} />
}
