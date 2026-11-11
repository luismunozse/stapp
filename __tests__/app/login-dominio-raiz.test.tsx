import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

const signIn = vi.fn()
const signOut = vi.fn()
vi.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => signIn(...args),
  signOut: (...args: unknown[]) => signOut(...args),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

import LoginPage from "@/app/(auth)/login/page"
import { tenantDashboardUrl } from "@/lib/auth-client"

// jsdom corre en `localhost`, que el login trata como dominio raíz (sin subdominio).
describe("login en el dominio raíz", () => {
  const locationOriginal = window.location
  let destino: { href: string }

  beforeEach(() => {
    signIn.mockReset().mockResolvedValue({ ok: true, error: null })
    signOut.mockReset().mockResolvedValue(undefined)
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/auth/user-organization") {
          return new Response(JSON.stringify({ organization: { slug: "taller-juan", nombre: "Taller Juan" } }))
        }
        return new Response("{}", { status: 404 })
      })
    )
    destino = { href: "http://localhost/login" }
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        hostname: "localhost",
        get href() {
          return destino.href
        },
        set href(v: string) {
          destino.href = v
        },
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    Object.defineProperty(window, "location", { configurable: true, value: locationOriginal })
  })

  // Antes se cerraba la sesión acá y se mandaba al login del subdominio con el
  // email precargado: el usuario tenía que escribir la contraseña dos veces.
  it("entra directo al panel del negocio sin cerrar la sesión ni pedir la contraseña de nuevo", async () => {
    render(<LoginPage />)

    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "juan@taller.com" } })
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "secreta123" } })
    fireEvent.click(screen.getByRole("button", { name: "Iniciar Sesión" }))

    await waitFor(() => expect(destino.href).toBe(tenantDashboardUrl("taller-juan")))
    expect(destino.href).not.toContain("/login")
    expect(destino.href).not.toContain("juan%40taller.com")
    expect(signOut).not.toHaveBeenCalled()
  })

  it("usa el voseo en los textos de la pantalla", async () => {
    render(<LoginPage />)
    expect(await screen.findByText("Ingresá tus datos para acceder")).toBeInTheDocument()
    expect(screen.getByText(/¿No tenés cuenta\?/)).toBeInTheDocument()
  })
})
