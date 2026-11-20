import { describe, it, expect, vi, beforeEach } from "vitest"

let native = true
let pluginAvailable = true
vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => native,
    isPluginAvailable: (name: string) => pluginAvailable && name === "SocialLogin",
  },
}))

const initialize = vi.fn()
const login = vi.fn()
vi.mock("@capgo/capacitor-social-login", () => ({
  SocialLogin: {
    initialize: (...a: unknown[]) => initialize(...a),
    login: (...a: unknown[]) => login(...a),
  },
}))

import {
  isNativeGoogleSignInAvailable,
  nativeGoogleSignIn,
  NativeGoogleSignInCancelled,
  __resetNativeGoogleSignInForTests,
} from "@/lib/native-google-signin"

beforeEach(() => {
  native = true
  pluginAvailable = true
  initialize.mockReset().mockResolvedValue(undefined)
  login.mockReset()
  __resetNativeGoogleSignInForTests()
})

describe("isNativeGoogleSignInAvailable", () => {
  it("is true only on native with the SocialLogin plugin", () => {
    expect(isNativeGoogleSignInAvailable()).toBe(true)
    pluginAvailable = false
    expect(isNativeGoogleSignInAvailable()).toBe(false)
    pluginAvailable = true
    native = false
    expect(isNativeGoogleSignInAvailable()).toBe(false)
  })
})

describe("nativeGoogleSignIn", () => {
  it("initializes once with the web client id and returns the idToken", async () => {
    login.mockResolvedValue({ provider: "google", result: { idToken: "tok-1" } })
    expect(await nativeGoogleSignIn("web-id")).toBe("tok-1")
    expect(await nativeGoogleSignIn("web-id")).toBe("tok-1")
    expect(initialize).toHaveBeenCalledTimes(1)
    expect(initialize).toHaveBeenCalledWith({
      google: { webClientId: "web-id", mode: "online", skipAuthOnlyAuthorizationAfterSignIn: true },
    })
    expect(login).toHaveBeenCalledWith({ provider: "google", options: {} })
  })

  it("throws when the result has no idToken", async () => {
    login.mockResolvedValue({ provider: "google", result: { idToken: null } })
    await expect(nativeGoogleSignIn("web-id")).rejects.toThrow(/idToken/)
  })

  it("maps USER_CANCELLED to NativeGoogleSignInCancelled", async () => {
    login.mockRejectedValue(Object.assign(new Error("cancelled"), { code: "USER_CANCELLED" }))
    await expect(nativeGoogleSignIn("web-id")).rejects.toBeInstanceOf(NativeGoogleSignInCancelled)
  })

  it("propagates other failures unchanged", async () => {
    const boom = new Error("boom")
    login.mockRejectedValue(boom)
    await expect(nativeGoogleSignIn("web-id")).rejects.toBe(boom)
  })

  it("retries initialize after a failed initialization", async () => {
    initialize.mockRejectedValueOnce(new Error("init failed"))
    login.mockResolvedValue({ provider: "google", result: { idToken: "t" } })
    await expect(nativeGoogleSignIn("web-id")).rejects.toThrow("init failed")
    expect(await nativeGoogleSignIn("web-id")).toBe("t")
    expect(initialize).toHaveBeenCalledTimes(2)
  })
})
