import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: process.env.NODE_ENV === "production",

  // Performance: 10% de transacciones en produccion
  tracesSampleRate: 0.1,

  // Replay solo en errores (no grabar sesiones por privacidad)
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,

  // Filtrar errores comunes que no son bugs
  ignoreErrors: [
    "ResizeObserver loop",
    "Network request failed",
    "Load failed",
    "Failed to fetch",
    "AbortError",
    "ChunkLoadError",
    "Loading chunk",
    "cancelled",
  ],

  beforeSend(event) {
    // No enviar errores de desarrollo
    if (process.env.NODE_ENV !== "production") return null
    return event
  },
})
