// Declaraciones de tipos globales para TypeScript

// Google Analytics
interface Window {
  gtag?: (
    command: "consent" | "event" | "config",
    target: string,
    config?: Record<string, any>
  ) => void
}
