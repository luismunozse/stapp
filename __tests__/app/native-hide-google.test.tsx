import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

// Google sign-in cannot work inside the Capacitor WebView (the popup leaves the
// app and Google blocks embedded WebViews), so the native shell must not offer it.

let native = false
let plugin = false
const nativeGoogleSignIn = vi.fn()
vi.mock("@/lib/native-google-signin", () => {
  class NativeGoogleSignInCancelled extends Error {}
  return {
    isNativeGoogleSignInAvailable: () => native && plugin,
    nativeGoogleSignIn: (...a: unknown[]) => nativeGoogleSignIn(...a),
    NativeGoogleSignInCancelled,
  }
})
vi.mock("@/lib/capacitor", () => ({
  isNativePlatform: () => native,
  getPlatform: () => (native ? "android" : "web"),
}))

const signIn = vi.fn()
vi.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => signIn(...args),
  signOut: vi.fn(),
}))

let mockSearchParams = new URLSearchParams()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => mockSearchParams,
}))

vi.mock("@react-oauth/google", () => ({
  GoogleOAuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  GoogleLogin: () => <button type="button">google-login</button>,
}))
vi.mock("@/components/shared/business-logo", () => ({ BusinessLogo: () => null }))
vi.mock("@/components/auth/auth-split-layout", () => ({
  AuthSplitLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock("@/components/auth/two-factor-verify", () => ({ TwoFactorVerify: () => null }))

import LoginPage from "@/app/(auth)/login/page"
import RegistroPage from "@/app/(auth)/registro/page"
import GoogleAuthPage from "@/app/google-auth/page"

const ROOT = "stapp.com.ar"

beforeEach(() => {
  native = false
  plugin = false
  nativeGoogleSignIn.mockReset()
  mockSearchParams = new URLSearchParams()
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "test-client-id")
  vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", ROOT)
  signIn.mockReset()
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 404 }))
  )
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const HINT = /¿Te registraste con Google\?/

describe("login: email recordado en el dispositivo", () => {
  afterEach(() => localStorage.clear())

  it("precarga el último email usado y ofrece los recientes", async () => {
    localStorage.setItem("stapp-emails-recientes", JSON.stringify(["luis@taller.com", "otro@taller.com"]))
    const { container } = render(<LoginPage />)
    const email = (await screen.findByLabelText("Email")) as HTMLInputElement
    await waitFor(() => expect(email.value).toBe("luis@taller.com"))
    expect(email).toHaveAttribute("autocomplete", "username")
    const opciones = [...container.querySelectorAll("datalist#emails-recientes option")].map((o) => o.getAttribute("value"))
    expect(opciones).toEqual(["luis@taller.com", "otro@taller.com"])
  })

  it("en la app nativa 'Recordarme' arranca marcado", async () => {
    native = true
    render(<LoginPage />)
    const recordar = (await screen.findByRole("checkbox")) as HTMLInputElement
    await waitFor(() => expect(recordar.checked).toBe(true))
  })
})

describe("login", () => {
  it("web: shows the Google button and no hint", async () => {
    render(<LoginPage />)
    expect(await screen.findByRole("button", { name: /Continuar con Google/ })).toBeInTheDocument()
    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
  })

  it("native: hides the Google button and shows the password-reset hint", async () => {
    native = true
    render(<LoginPage />)
    expect(await screen.findByText(HINT)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Olvidaste tu contraseña/ })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Continuar con Google/ })).not.toBeInTheDocument()
  })

  async function submitWithGoogleOnlyAccount() {
    signIn.mockResolvedValue({ ok: false, error: "USE_GOOGLE_LOGIN" })
    render(<LoginPage />)
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "a@b.com" } })
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "secreta123" } })
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }))
  }

  it("web: USE_GOOGLE_LOGIN keeps the Google button message", async () => {
    await submitWithGoogleOnlyAccount()
    expect(await screen.findByText(/Usá el botón "Continuar con Google"/)).toBeInTheDocument()
  })

  it("native: USE_GOOGLE_LOGIN tells the user to create a password", async () => {
    native = true
    await submitWithGoogleOnlyAccount()
    await waitFor(() =>
      expect(screen.getByText(/Esta cuenta fue creada con Google\. En la app, creá una contraseña/)).toBeInTheDocument()
    )
    expect(screen.queryByText(/Usá el botón/)).not.toBeInTheDocument()
  })
})

describe("registro", () => {
  it("web: shows the Google signup button", async () => {
    render(<RegistroPage />)
    expect(await screen.findByRole("button", { name: /Registrarse con Google/ })).toBeInTheDocument()
  })

  it("native: hides the Google signup button, email signup stays", async () => {
    native = true
    render(<RegistroPage />)
    expect(await screen.findByLabelText("Tu nombre")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Registrarse con Google/ })).not.toBeInTheDocument()
  })
})

describe("google-auth", () => {
  it("web: renders the Google button", async () => {
    render(<GoogleAuthPage />)
    expect(await screen.findByText("google-login")).toBeInTheDocument()
  })

  it("native: no Google button, explains and links back to the tenant login", async () => {
    native = true
    mockSearchParams = new URLSearchParams({ tenant: "mi-taller" })
    render(<GoogleAuthPage />)
    expect(await screen.findByText(/El ingreso con Google no está disponible en la app/)).toBeInTheDocument()
    expect(screen.queryByText("google-login")).not.toBeInTheDocument()
    const link = screen.getByRole("link", { name: /Entrar con email y contraseña/ })
    expect(link.getAttribute("href")).toBe(`https://mi-taller.${ROOT}/login`)
  })

  it("native: invalid tenant falls back to /app-entry", async () => {
    native = true
    mockSearchParams = new URLSearchParams({ tenant: "evil.com/x#" })
    render(<GoogleAuthPage />)
    const link = await screen.findByRole("link", { name: /Entrar con email y contraseña/ })
    expect(link.getAttribute("href")).toBe("/app-entry")
  })
})

describe("native WITH the social login plugin", () => {
  beforeEach(() => {
    native = true
    plugin = true
  })

  it("login: shows the Google button and no hint", async () => {
    render(<LoginPage />)
    expect(await screen.findByRole("button", { name: /Continuar con Google/ })).toBeInTheDocument()
    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
  })

  it("login: USE_GOOGLE_LOGIN keeps the Google button message", async () => {
    signIn.mockResolvedValue({ ok: false, error: "USE_GOOGLE_LOGIN" })
    render(<LoginPage />)
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "a@b.com" } })
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "secreta123" } })
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }))
    expect(await screen.findByText(/Usá el botón "Continuar con Google"/)).toBeInTheDocument()
  })

  it("registro: shows the Google signup button", async () => {
    render(<RegistroPage />)
    expect(await screen.findByRole("button", { name: /Registrarse con Google/ })).toBeInTheDocument()
  })

  it("google-auth: native button feeds the idToken into signIn credentials", async () => {
    nativeGoogleSignIn.mockResolvedValue("id-token-1")
    signIn.mockResolvedValue({ ok: false, error: "GOOGLE_NO_ACCOUNT" })
    render(<GoogleAuthPage />)
    expect(screen.queryByText("google-login")).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole("button", { name: /Continuar con Google/ }))
    await waitFor(() =>
      expect(signIn).toHaveBeenCalledWith(
        "credentials",
        expect.objectContaining({ googleIdToken: "id-token-1" })
      )
    )
    expect(nativeGoogleSignIn).toHaveBeenCalledWith("test-client-id")
  })

  it("google-auth: register action uses the signup wording", async () => {
    mockSearchParams = new URLSearchParams({ action: "register" })
    render(<GoogleAuthPage />)
    expect(await screen.findByRole("button", { name: /Registrarse con Google/ })).toBeInTheDocument()
  })

  it("google-auth: cancel shows no error and resets the button", async () => {
    const { NativeGoogleSignInCancelled } = await import("@/lib/native-google-signin")
    nativeGoogleSignIn.mockRejectedValue(new NativeGoogleSignInCancelled())
    render(<GoogleAuthPage />)
    fireEvent.click(await screen.findByRole("button", { name: /Continuar con Google/ }))
    await waitFor(() => expect(nativeGoogleSignIn).toHaveBeenCalled())
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(await screen.findByRole("button", { name: /Continuar con Google/ })).toBeEnabled()
    expect(signIn).not.toHaveBeenCalled()
  })

  it("google-auth: other failures show a Spanish error", async () => {
    nativeGoogleSignIn.mockRejectedValue(new Error("boom"))
    render(<GoogleAuthPage />)
    fireEvent.click(await screen.findByRole("button", { name: /Continuar con Google/ }))
    expect(
      await screen.findByText("No se pudo iniciar sesión con Google. Intentá de nuevo.")
    ).toBeInTheDocument()
  })
})
