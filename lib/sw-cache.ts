/**
 * Asks the service worker to drop its API cache — and only that one.
 *
 * Callers are on identity paths (a different user logging in, a branch switch),
 * which on a counter tablet that rotates operators happens often. The navigation
 * shell and the static assets have nothing to do with the session, so taking
 * them out too would cost that device the ability to boot offline. `cache: api`
 * is what keeps the blast radius at the responses that actually vary.
 */
export function clearServiceWorkerApiCache(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return
  navigator.serviceWorker.controller?.postMessage({ type: "CLEAR_CACHE", cache: "api" })
}
