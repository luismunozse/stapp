/**
 * Asks the service worker to drop every `stapp-*` cache it holds.
 *
 * The Cache API is keyed by the URL alone — no cookie, no user, no org — so a
 * cached API response has no idea whose data it is. Dropping the cache when the
 * identity behind it changes is therefore not a nicety, it is the ONLY scoping
 * the browser cache can have. See `ApiCacheSessionGuard` (session identity) and
 * `SucursalSwitcher` (active branch).
 *
 * Fire-and-forget by design: there is nothing useful to do if the message never
 * lands, and every caller is on a path (login, branch switch, recovery) that
 * must not be blocked or broken by the absence of a worker.
 */
export function clearServiceWorkerCache(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return
  navigator.serviceWorker.controller?.postMessage({ type: "CLEAR_CACHE" })
}
