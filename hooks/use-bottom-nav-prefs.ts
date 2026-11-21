import { useCallback, useSyncExternalStore } from "react"

// Per device on purpose: the bottom bar is a phone thing, and the same person
// may want different shortcuts on the counter tablet and on their own phone.
const KEY = "stapp-bottom-nav"
const EVENT = "stapp-bottom-nav-change"

function read(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange)
  window.addEventListener(EVENT, onChange)
  return () => {
    window.removeEventListener("storage", onChange)
    window.removeEventListener(EVENT, onChange)
  }
}

function parse(raw: string | null): string[] | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw)
    return Array.isArray(value) && value.every((v) => typeof v === "string") ? value : null
  } catch {
    return null
  }
}

/**
 * Hrefs the user pinned to the phone bottom bar (`null` = role default).
 * Server and first client render read `null`, so hydration matches.
 */
export function useBottomNavPrefs(): [string[] | null, (hrefs: string[] | null) => void] {
  const raw = useSyncExternalStore(subscribe, read, () => null)
  const save = useCallback((hrefs: string[] | null) => {
    try {
      if (hrefs && hrefs.length > 0) localStorage.setItem(KEY, JSON.stringify(hrefs))
      else localStorage.removeItem(KEY)
    } catch {
      /* storage blocked: the bar just keeps the default */
    }
    window.dispatchEvent(new Event(EVENT))
  }, [])
  return [parse(raw), save]
}
