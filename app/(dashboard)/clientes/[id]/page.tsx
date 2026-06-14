import { ClienteDetalle } from "@/components/clientes/detalle/cliente-detalle"

export default async function ClienteDetallePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <ClienteDetalle clienteId={id} />
}
