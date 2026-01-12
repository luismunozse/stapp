import type { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  const baseUrl = "https://stapp.com.ar"

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
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
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  }
}
