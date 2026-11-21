"use client"

import { useEffect, useSyncExternalStore } from "react"
import { usePathname } from "next/navigation"

/**
 * Screen title shown in the phone's top app bar, like a native app ("Órdenes
 * de servicio" up there instead of a big heading under the logo bar).
 *
 * PageHeader publishes its title here; the mobile navbar reads it. The title
 * is tied to the path it was published for, so a screen without a PageHeader
 * never shows the previous screen's title (and nothing flashes in between).
 */
type AppTitle = { title: string; path: string; backHref?: string } | null

let current: AppTitle = null
const listeners = new Set<() => void>()

function publish(next: AppTitle) {
  current = next
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Renders nothing; publishes `title` (and, for sub/detail screens, where the
 * app bar's back arrow goes) for this route.
 */
export function AppTitleSync({ title, backHref }: { title: string; backHref?: string }) {
  const path = usePathname()
  useEffect(() => {
    publish({ title, path, backHref })
    return () => {
      if (current?.path === path && current.title === title) publish(null)
    }
  }, [title, path, backHref])
  return null
}

/** Title (and back target) for the current route, or null when none was published. */
export function useAppTitle(): { title: string; backHref?: string } | null {
  const path = usePathname()
  const value = useSyncExternalStore(subscribe, () => current, () => null)
  return value && value.path === path ? { title: value.title, backHref: value.backHref } : null
}
