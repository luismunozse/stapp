/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Asegura que Vercel empaquete el binario de Chromium para los handlers de PDF
  serverExternalPackages: ["@sparticuz/chromium-min", "puppeteer-core"],
  outputFileTracingIncludes: {
    // App Router paths
    "/app/api/ordenes/[id]/pdf/route": [
      "./node_modules/@sparticuz/chromium-min/**",
    ],
    "/app/api/public/ordenes/[token]/pdf/route": [
      "./node_modules/@sparticuz/chromium-min/**",
    ],
    // Route matchers without /app prefix (for safety)
    "/api/ordenes/[id]/pdf": [
      "./node_modules/@sparticuz/chromium-min/**",
    ],
    "/api/public/ordenes/[token]/pdf": [
      "./node_modules/@sparticuz/chromium-min/**",
    ],
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
    ],
  },
  // PWA
  async headers() {
    return [
      {
        source: '/manifest.json',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/manifest+json',
          },
        ],
      },
    ]
  },
}

module.exports = nextConfig

