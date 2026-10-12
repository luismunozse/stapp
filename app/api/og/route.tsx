import { ImageResponse } from "next/og"
import { NextRequest } from "next/server"
import { OgCard, OG_SIZE } from "@/lib/og/card"

export const runtime = "edge"

// Unico generador de imagenes Open Graph del sitio.
//
// Antes convivia con app/opengraph-image.tsx, que por ser convencion de Next
// pisaba el openGraph.images del metadata. El resultado eran dos tarjetas
// distintas: og:image servia una (oscura, sin el logo real) y twitter:image
// otra. Ese archivo se elimino; esta ruta es la unica fuente.
export function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const titulo = searchParams.get("title") ?? undefined
  const descripcion = searchParams.get("description") ?? undefined

  return new ImageResponse(
    <OgCard titulo={titulo} descripcion={descripcion} />,
    OG_SIZE
  )
}
