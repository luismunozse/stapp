import type { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  const baseUrl = "https://stapp.com.ar"

  return {
    rules: [
      {
        userAgent: "*",
        // El disallow de /api/ es correcto por defecto, pero se lleva puestas
        // una ruta que las paginas publicas necesitan. Se habilita por
        // separado: en la especificacion de robots.txt gana la regla mas
        // especifica, y esta es mas larga que "/api/".
        allow: [
          "/",
          // Imagen de Open Graph. La usan las tarjetas de compartido de todo
          // el sitio (openGraph y twitter en app/layout.tsx), la de cada post
          // del blog con el titulo renderizado, y el campo `screenshot` del
          // schema. Bloqueada, los crawlers de WhatsApp, Twitter, LinkedIn y
          // Google no pueden traerla y el preview sale sin imagen.
          "/api/og",
        ],
        disallow: [
          "/api/",
          "/dashboard/",
          "/ordenes/",
          "/clientes/",
          "/tecnicos/",
          "/configuracion/",
          "/facturacion/",
          "/reportes/",
          "/inventario/",
          "/monitoring",
        ],
      },
    ],
    // El indice alcanza para que Google descubra los dos hijos, pero se
    // listan igual: algunos rastreadores no siguen un sitemapindex.
    sitemap: [
      `${baseUrl}/sitemap.xml`,
      `${baseUrl}/sitemap-marketing.xml`,
      `${baseUrl}/sitemap-catalogos.xml`,
    ],
  }
}
