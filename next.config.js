// Identificador único por build/deploy. En Vercel usa el SHA del commit;
// en local cae a un timestamp. Se inyecta en cliente y servidor para detectar
// cuándo hay una versión nueva desplegada (ver PWAUpdater + /api/version).
const BUILD_ID =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.VERCEL_DEPLOYMENT_ID ||
  String(Date.now())

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_BUILD_ID: BUILD_ID,
  },
  generateBuildId: () => BUILD_ID,
  // firebase-admin uses dynamic requires and optional native gRPC deps that the
  // bundler cannot trace. Keep it external so it is resolved at runtime instead.
  serverExternalPackages: ['firebase-admin'],
  outputFileTracingIncludes: {
    '/api/**': ['./lib/fonts/**/*'],
  },
  images: {
    formats: ['image/avif', 'image/webp'],
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
  // EN → ES redirects para rutas intuitivas del superadmin
  async redirects() {
    return [
      {
        source: "/superadmin/organizations/:path*",
        destination: "/superadmin/organizaciones/:path*",
        permanent: true,
      },
      {
        source: "/superadmin/chatbot/:path*",
        destination: "/superadmin/conversaciones/:path*",
        permanent: true,
      },
      {
        source: "/superadmin/chatbot",
        destination: "/superadmin/conversaciones",
        permanent: true,
      },
      {
        source: "/superadmin/subscriptions/:path*",
        destination: "/superadmin/suscripciones/:path*",
        permanent: true,
      },
      {
        source: "/superadmin/payments/:path*",
        destination: "/superadmin/pagos/:path*",
        permanent: true,
      },
      {
        source: "/superadmin/plans/:path*",
        destination: "/superadmin/planes/:path*",
        permanent: true,
      },
      {
        source: "/superadmin/support/:path*",
        destination: "/superadmin/soporte/:path*",
        permanent: true,
      },
      {
        source: "/superadmin/audit/:path*",
        destination: "/superadmin/logs/:path*",
        permanent: true,
      },
      {
        source: "/superadmin/maintenance/:path*",
        destination: "/superadmin/maintenance-banner/:path*",
        permanent: true,
      },
    ]
  },
  // PWA + SEO headers
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
      {
        source: '/opensearch.xml',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/opensearchdescription+xml',
          },
        ],
      },
    ]
  },
}

module.exports = nextConfig
