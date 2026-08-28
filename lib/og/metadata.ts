import type { Metadata } from "next"

type OGImage = NonNullable<NonNullable<Metadata["openGraph"]>["images"]> extends
  | infer T
  | readonly (infer T)[]
  ? T
  : never

/**
 * Imagen de Open Graph para el metadata de las paginas.
 *
 * Hace falta porque **Next no mergea `openGraph` en profundidad**: una pagina
 * que declara su propio bloque `openGraph` pierde entero el del layout raiz,
 * `images` incluido, y se queda sin `og:image`. No hay herencia parcial.
 *
 * Y la convencion `app/opengraph-image.tsx` **no cascadea**: cubre unicamente
 * el segmento donde vive. Verificado en produccion — con el archivo en la raiz,
 * `/` tenia og:image y `/precios`, `/ayuda`, `/empresa/blog` y `/registro` no.
 *
 * Asi que toda pagina que declare `openGraph` tiene que declarar tambien sus
 * `images`. Esta constante evita repetir la URL y el tamano en cada una.
 * `lib/__tests__/og-cobertura.test.ts` verifica que no falte en ninguna.
 */
export const OG_IMAGES: OGImage[] = [
  {
    // El v= es cache-buster: WhatsApp, Twitter y Facebook cachean por URL, asi
    // que cambiar el diseno sin cambiar la URL no se ve.
    url: "/api/og?v=4",
    width: 1200,
    height: 630,
    alt: "STApp - Software de gestión para talleres de reparación",
  },
]
