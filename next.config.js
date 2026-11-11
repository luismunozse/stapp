// Identificador único por build/deploy. En Vercel usa el SHA del commit;
// en local cae a un timestamp. Se inyecta en cliente y servidor para detectar
// cuándo hay una versión nueva desplegada (ver PWAUpdater + /api/version).
const BUILD_ID =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.VERCEL_DEPLOYMENT_ID ||
  String(Date.now())

// Headers de seguridad para todas las respuestas.
// - frame-ancestors: solo STApp puede embeber sus páginas (la vista previa
//   del catálogo usa un iframe propio). Reemplaza a X-Frame-Options, que no
//   puede expresar "mis subdominios".
// - La CSP es deliberadamente acotada: directivas que no afectan qué scripts
//   carga la app (GA, MercadoPago, Google OAuth, Supabase). Una CSP de
//   script-src necesita relevar esos orígenes antes, en modo Report-Only.
const SECURITY_HEADERS = [
  {
    key: 'Content-Security-Policy',
    value: [
      "frame-ancestors 'self' https://stapp.com.ar https://*.stapp.com.ar",
      "base-uri 'self'",
      "object-src 'none'",
    ].join('; '),
  },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_BUILD_ID: BUILD_ID,
  },
  generateBuildId: () => BUILD_ID,
  serverExternalPackages: [],
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
  async rewrites() {
    return [
      // Digital Asset Links (App Links de Android). Google exige el archivo en
      // /.well-known/assetlinks.json y sin redirects. El handler vive bajo
      // /api/public para caer en las rutas que el middleware ya trata como
      // públicas; el rewrite conserva la URL que verifica Android.
      {
        source: '/.well-known/assetlinks.json',
        destination: '/api/public/assetlinks',
      },
    ]
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
        source: '/:path*',
        headers: SECURITY_HEADERS,
      },
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
