import { SubirFotosCelular } from "@/components/fotos/subir-fotos-celular"

interface PageProps {
  params: Promise<{ token: string }>
}

export default async function SubirFotosPage({ params }: PageProps) {
  const { token } = await params
  return <SubirFotosCelular token={token} />
}
