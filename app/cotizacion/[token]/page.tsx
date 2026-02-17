import { CotizacionPublica } from "@/components/cotizaciones/cotizacion-publica"

interface PageProps {
  params: Promise<{ token: string }>
}

export default async function CotizacionPublicPage({ params }: PageProps) {
  const { token } = await params
  return <CotizacionPublica token={token} />
}
