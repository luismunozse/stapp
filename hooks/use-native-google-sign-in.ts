import { useSyncExternalStore } from "react"
import { isNativeGoogleSignInAvailable } from "@/lib/native-google-signin"

const subscribe = () => () => {}

/**
 * True only inside the native shell with the SocialLogin plugin installed.
 * Server snapshot and first client render are false, so hydration matches.
 */
export function useNativeGoogleSignInAvailable(): boolean {
  return useSyncExternalStore(subscribe, isNativeGoogleSignInAvailable, () => false)
}
