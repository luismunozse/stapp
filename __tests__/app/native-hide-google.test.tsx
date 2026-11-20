import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

// Google sign-in cannot work inside the Capacitor WebView (the popup leaves the
// app and Google blocks embedded WebViews), so the native shell must not offer it.

let native = false
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
