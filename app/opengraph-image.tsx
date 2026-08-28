import { ImageResponse } from "next/og"
import { OgCard, OG_SIZE } from "@/lib/og/card"

export const runtime = "edge"

export const alt = "STApp - Software de gestión para talleres de reparación"
export const size = OG_SIZE
export const contentType = "image/png"

/**
 * og:image de todo el sitio.
 *
 * Esta convencion de Next se aplica al segmento y a todos sus hijos, y pisa el
 * `openGraph.images` del metadata. Eso importa porque en Next `openGraph` NO se
 * mergea en profundidad: una pagina que declara su propio bloque `openGraph`
 * sin `images` — y hay once — pierde la imagen heredada del layout raiz. Este
 * archivo es lo unico que las cubre a todas.
 *
 * El bug que se arreglo en #364 no era que este archivo existiera, sino que
 * dibujaba una tarjeta DISTINTA a la de /api/og: og:image servia una y
 * twitter:image otra. Borrarlo dejo al sitio sin og:image en ningun lado, asi
 * que vuelve — pero renderizando exactamente la misma OgCard. Un solo diseno,
 * dos vias de entrega, sin forma de divergir.
 *
 * Para las tarjetas con titulo propio (posts del blog) sigue estando
 * /api/og?title=..., que esas paginas declaran explicitamente.
 */
export default function Image() {
  return new ImageResponse(<OgCard />, OG_SIZE)
}
