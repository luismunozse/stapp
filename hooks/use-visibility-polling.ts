import { useEffect, useRef } from 'react'

/**
 * useVisibilityPolling
 *
 * Calls `callback` every `intervalMs` while the document is visible and
 * `enabled` is true. Pauses when the tab is hidden; fires once immediately
 * (catch-up) when the tab becomes visible again, then resumes the interval.
 *
 * The callback is held in a ref so a changing identity does not reset the
 * interval timer.
 */
export function useVisibilityPolling(
  callback: () => void,
  intervalMs: number,
  enabled: boolean,
): void {
  // Always hold the latest callback without causing effect re-runs
  const callbackRef = useRef(callback)
  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  useEffect(() => {
    if (!enabled) return

    let timerId: ReturnType<typeof setInterval> | null = null

    function startInterval() {
      timerId = setInterval(() => {
        callbackRef.current()
      }, intervalMs)
    }

    function stopInterval() {
      if (timerId !== null) {
        clearInterval(timerId)
        timerId = null
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        stopInterval()
      } else {
        // Catch-up fire, then restart the regular interval
        callbackRef.current()
        startInterval()
      }
    }

    // Only start polling when the tab is visible
    if (document.visibilityState !== 'hidden') {
      startInterval()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      stopInterval()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [enabled, intervalMs])
}
