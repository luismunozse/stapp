import { useSyncExternalStore } from "react"
import { isNativePlatform } from "@/lib/capacitor"

const subscribe = () => () => {}

/**
 * True only inside the Capacitor native shell. The server snapshot and the
 * first client render are always false (web), so hydration matches; the real
 * value is applied right after mount.
 */
export function useIsNativePlatform(): boolean {
  return useSyncExternalStore(subscribe, isNativePlatform, () => false)
}
