import { SeguimientoContent } from "@/components/seguimiento/seguimiento-content"

interface PageProps {
  params: Promise<{ token: string }>
}

export default async function SeguimientoPage({ params }: PageProps) {
  const { token } = await params
  return <SeguimientoContent token={token} />
}
