import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

// /google-auth recibe `tenant` y `orgSlug` por query string y los interpolaba
// crudos en un hostname asignado a window.location.href:
//   ?tenant=evil.com/x%23  ->  https://evil.com/x#.stapp.com.ar/dashboard
// (host real: evil.com). Estos tests fijan que ningun destino salga de
// <label>.<rootDomain> y que un valor invalido se comporte como "sin tenant".

let mockSearchParams = new URLSearchParams()
vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
}))

const signIn = vi.fn()
vi.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => signIn(...args),
}))

// El boton real de Google es un iframe; este stub dispara onSuccess con una
// credencial fija para poder manejar handleGoogleSuccess desde el test.
vi.mock("@react-oauth/google", () => ({
  GoogleOAuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  GoogleLogin: ({ onSuccess }: { onSuccess: (r: { credential?: string }) => void }) => (
    <button type="button" onClick={() => onSuccess({ credential: "google-cred" })}>
      google-login
    </button>
  ),
}))

vi.mock("@/components/shared/business-logo", () => ({ BusinessLogo: () => null }))
vi.mock("@/components/ui/theme-toggle", () => ({ ThemeToggle: () => null }))

import GoogleAuthPage from "@/app/google-auth/page"

const ROOT = "stapp.com.ar"
const ORIGINAL_LOCATION = window.location

function setLocation() {
  Object.defineProperty(window, "location", {
    value: { href: "" },
    writable: true,
    configurable: true,
  })
}

function renderPage(params: Record<string, string>) {
  mockSearchParams = new URLSearchParams(params)
  return render(<GoogleAuthPage />)
}

const href = () => window.location.href

// Destino seguro = ruta relativa del mismo origen, o https://<un label>.<ROOT>/...
function expectSafeDestination(value: string) {
  if (value.startsWith("/") && !value.startsWith("//")) return
  const url = new URL(value)
  expect(url.protocol).toBe("https:")
  expect(url.hostname).toMatch(new RegExp(`^[a-z0-9-]+\\.${ROOT.replace(/\./g, "\\.")}$`))
}

const ATTACKS = [
  "evil.com/x#",
  "evil.com",
  "a.evil.com",
  "//evil.com",
  "EVIL con espacios",
  "-bad",
  "javascript:alert(1)",
]

let orgFetch: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "test-client-id")
  vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", ROOT)
  setLocation()
  signIn.mockReset().mockResolvedValue({ ok: true, error: null })
  orgFetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ organization: { slug: "acme" } }),
  })
  vi.stubGlobal("fetch", orgFetch)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  Object.defineProperty(window, "location", {
    value: ORIGINAL_LOCATION,
    writable: true,
    configurable: true,
  })
})

describe("/google-auth - login exitoso con tenant", () => {
  it("tenant valido: redirige al dashboard de ese subdominio", async () => {
    renderPage({ tenant: "mi-taller" })
    fireEvent.click(screen.getByText("google-login"))
    await waitFor(() => expect(href()).toBe(`https://mi-taller.${ROOT}/dashboard`))
    expect(orgFetch).not.toHaveBeenCalled()
  })

  it("normaliza mayusculas y espacios: Mi-Taller -> host en minusculas", async () => {
    renderPage({ tenant: "  Mi-Taller " })
    fireEvent.click(screen.getByText("google-login"))
    await waitFor(() => expect(href()).toBe(`https://mi-taller.${ROOT}/dashboard`))
  })

  it.each(ATTACKS)(
    "tenant invalido %j: se comporta como sin tenant y no sale del dominio",
    async (tenant) => {
      renderPage({ tenant })
      fireEvent.click(screen.getByText("google-login"))
      // Rama "sin tenant": pregunta por la org del usuario autenticado.
      await waitFor(() => expect(href()).toBe(`https://acme.${ROOT}/dashboard`))
      expect(orgFetch).toHaveBeenCalledWith("/api/auth/user-organization", expect.anything())
      expectSafeDestination(href())
    }
  )
})

describe("/google-auth - 2FA requerido con tenant", () => {
  beforeEach(() => {
    signIn.mockResolvedValue({ ok: false, error: "REQUIRES_2FA:user-1" })
  })

  it("tenant valido: lleva al login del subdominio", async () => {
    renderPage({ tenant: "mi-taller" })
    fireEvent.click(screen.getByText("google-login"))
    await waitFor(() => expect(href()).toBe(`https://mi-taller.${ROOT}/login?needs2fa=true`))
  })

  it("Mi-Taller: host en minusculas", async () => {
    renderPage({ tenant: "Mi-Taller" })
    fireEvent.click(screen.getByText("google-login"))
    await waitFor(() => expect(href()).toBe(`https://mi-taller.${ROOT}/login?needs2fa=true`))
  })

  it.each(ATTACKS)("tenant invalido %j: cae al /login relativo", async (tenant) => {
    renderPage({ tenant })
    fireEvent.click(screen.getByText("google-login"))
    await waitFor(() => expect(href()).toBe("/login?needs2fa=true"))
    expectSafeDestination(href())
  })
})

describe("/google-auth - boton Volver", () => {
  it.each([
    ["login", "login"],
    ["register", "registro"],
  ])("tenant valido, action=%s: vuelve a /%s del subdominio", (action, path) => {
    renderPage({ action, tenant: "Mi-Taller" })
    fireEvent.click(screen.getByRole("button", { name: "Volver" }))
    expect(href()).toBe(`https://mi-taller.${ROOT}/${path}`)
  })

  it.each(ATTACKS)("tenant invalido %j: vuelve a /login relativo", (tenant) => {
    renderPage({ tenant })
    fireEvent.click(screen.getByRole("button", { name: "Volver" }))
    expect(href()).toBe("/login")
    expectSafeDestination(href())
  })

  it.each(ATTACKS)("tenant invalido %j, action=register: vuelve a /registro relativo", (tenant) => {
    renderPage({ action: "register", tenant })
    fireEvent.click(screen.getByRole("button", { name: "Volver" }))
    expect(href()).toBe("/registro")
    expectSafeDestination(href())
  })
})

describe("/google-auth - registro exitoso con orgSlug", () => {
  let registerFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    registerFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, organization: { slug: "mi-taller" } }),
    })
    vi.stubGlobal("fetch", registerFetch)
  })

  const register = (orgSlug: string) =>
    renderPage({ action: "register", orgNombre: "Mi Taller", orgSlug, userName: "Ana" })

  it("orgSlug valido: redirige al login del subdominio con registered=true", async () => {
    register("mi-taller")
    fireEvent.click(screen.getByText("google-login"))
    await waitFor(() => expect(href()).toBe(`https://mi-taller.${ROOT}/login?registered=true`))
  })

  it("envia al API el orgSlug tal como llego (sin tocarlo)", async () => {
    register("mi-taller")
    fireEvent.click(screen.getByText("google-login"))
    await waitFor(() => expect(registerFetch).toHaveBeenCalledTimes(1))
    const body = JSON.parse((registerFetch.mock.calls[0][1] as { body: string }).body)
    expect(body.organizacion.slug).toBe("mi-taller")
  })

  it.each(ATTACKS)(
    "orgSlug invalido %j (API mockeada en OK): no navega fuera del dominio",
    async (orgSlug) => {
      register(orgSlug)
      fireEvent.click(screen.getByText("google-login"))
      await waitFor(() => expect(href()).toBe("/login?registered=true"))
      expectSafeDestination(href())
    }
  )
})
