import { Capacitor } from "@capacitor/core"

/** The user dismissed the native account picker. Not an error to surface. */
export class NativeGoogleSignInCancelled extends Error {
  constructor() {
    super("Google sign-in cancelled")
    this.name = "NativeGoogleSignInCancelled"
  }
}

/**
 * True only inside the native shell AND when the installed APK bundles the
 * SocialLogin plugin. Older installs (without the plugin) must keep the
 * email/password-only behavior.
 */
export function isNativeGoogleSignInAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("SocialLogin")
}

let initPromise: Promise<void> | null = null

async function ensureInitialized(webClientId: string): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const { SocialLogin } = await import("@capgo/capacitor-social-login")
      await SocialLogin.initialize({
        google: {
          // The backend verifies aud against the WEB client id.
          webClientId,
          mode: "online",
          // Stock BridgeActivity can hang on the extra authorize() step; only the idToken is needed.
          skipAuthOnlyAuthorizationAfterSignIn: true,
        },
      })
    })().catch((err) => {
      initPromise = null
      throw err
    })
  }
  return initPromise
}

/** Opens the native Android account picker and returns the Google ID token. */
export async function nativeGoogleSignIn(webClientId: string): Promise<string> {
  await ensureInitialized(webClientId)
  const { SocialLogin } = await import("@capgo/capacitor-social-login")
  try {
    const res = await SocialLogin.login({ provider: "google", options: {} })
    const idToken = (res.result as { idToken?: string | null } | undefined)?.idToken
    if (!idToken) throw new Error("Google sign-in returned no idToken")
    return idToken
  } catch (err) {
    if ((err as { code?: string } | null)?.code === "USER_CANCELLED") {
      throw new NativeGoogleSignInCancelled()
    }
    throw err
  }
}

export function __resetNativeGoogleSignInForTests(): void {
  initPromise = null
}
