/** Cuánto se espera la confirmación del worker antes de darla por no ocurrida. */
const CONFIRMACION_TIMEOUT_MS = 1500

/**
 * Asks the service worker to drop its API cache — and only that one.
 *
 * Callers are on identity paths (a different user logging in, a branch switch),
 * which on a counter tablet that rotates operators happens often. The navigation
 * shell and the static assets have nothing to do with the session, so taking
 * them out too would cost that device the ability to boot offline. `cache: api`
 * is what keeps the blast radius at the responses that actually vary.
 *
 * Resolves TRUE only when the worker answered CACHE_CLEARED, i.e. the deletion
 * really happened. It resolves false — never throws, never hangs — when there is
 * no controller to talk to (right after a force-reload, with a new worker still
 * activating before `clients.claim()`, or if registration failed) and when the
 * answer does not arrive in time. Callers must be able to tell "I cleared it"
 * from "there was nobody to ask": treating the second as success is what let a
 * previous session's cache stay served indefinitely.
 */
export function clearServiceWorkerApiCache(): Promise<boolean> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return Promise.resolve(false)
  }
  const controller = navigator.serviceWorker.controller
  if (!controller) return Promise.resolve(false)

  return new Promise<boolean>((resolve) => {
    let listo = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const terminar = (limpio: boolean) => {
      if (listo) return
      listo = true
      if (timer) clearTimeout(timer)
      navigator.serviceWorker.removeEventListener("message", alRecibir)
      resolve(limpio)
    }

    const alRecibir = (event: MessageEvent) => {
      if (event.data?.type === "CACHE_CLEARED") terminar(true)
    }

    navigator.serviceWorker.addEventListener("message", alRecibir)
    timer = setTimeout(() => terminar(false), CONFIRMACION_TIMEOUT_MS)
    controller.postMessage({ type: "CLEAR_CACHE", cache: "api" })
  })
}
