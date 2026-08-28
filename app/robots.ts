import type { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  const baseUrl = "https://stapp.com.ar"

  return {
    rules: [
      {
        userAgent: "*",
        // El disallow de /api/ es correcto por defecto, pero se lleva puestas
        // dos rutas que las paginas publicas necesitan. Se habilitan por
        // separado: en la especificacion de robots.txt gana la regla mas
        // especifica, y estas son mas largas que "/api/".
        allow: [
          "/",
          // Imagen de Open Graph. La usan las tarjetas de compartido de todo
          // el sitio (openGraph y twitter en app/layout.tsx), la de cada post
          // del blog con el titulo renderizado, y el campo `screenshot` del
          // schema. Bloqueada, los crawlers de WhatsApp, Twitter, LinkedIn y
          // Google no pueden traerla y el preview sale sin imagen.
          "/api/og",
          // Info de la APK. /descargar/android la pide desde el cliente para
          // renderizar version, tamano y el boton de descarga. Googlebot
          // ejecuta JS: bloqueada, indexa la pagina en su estado "APK no
          // disponible".
          "/api/download/apk-info",
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
    sitemap: `${baseUrl}/sitemap.xml`,
  }
}
