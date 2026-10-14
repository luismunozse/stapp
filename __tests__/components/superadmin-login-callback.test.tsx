import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

/**
 * El login de superadmin leia `?callbackUrl=` y se lo asignaba tal cual a
 * `window.location.href` tras un login exitoso:
 *
 *  - `?callbackUrl=https://evil.com`   -> open redirect despues de autenticar.
 *  - `?callbackUrl=javascript:...`     -> ejecucion de script (XSS) en el
 *                                         origen del panel de superadmin.
 *
 * El middleware solo escribe rutas propias (`/superadmin/...`), asi que
 * cualquier otro valor es manipulado. Se fija que el destino post-login sea
 * siempre una ruta relativa del mismo origen, en las DOS salidas del login
 * (credenciales directas y verificacion 2FA).
 */

const { signInMock, searchParamsRef } = vi.hoisted(() => ({
  signInMock: vi.fn(),
  searchParamsRef: { current: new URLSearchParams() },
}))

vi.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => signInMock(...args),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => searchParamsRef.current,
}))

// El paso 2FA real pega contra la API; aca solo importa que, al verificar,
// el login dispare la navegacion.
vi.mock("@/components/auth/two-factor-verify", () => ({
  TwoFactorVerify: ({ onVerified }: { onVerified: (code: string) => void }) => (
    <button type="button" onClick={() => onVerified("123456")}>
      verificar-2fa
    </button>
  ),
}))

import SuperadminLoginPage from "@/app/superadmin-login/page"

const FALLBACK = "/superadmin/dashboard"

function setCallbackUrl(value: string | null) {
  const params = new URLSearchParams()
  if (value !== null) params.set("callbackUrl", value)
  searchParamsRef.current = params
}

async function submitCredentials() {
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "root@stapp.com.ar" },
  })
  fireEvent.change(screen.getByLabelText("Contraseña"), {
    target: { value: "secreto-123" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Acceder al Panel" }))
}

describe("superadmin-login — destino post-login (callbackUrl)", () => {
  const originalLocation = window.location

  beforeEach(() => {
    signInMock.mockReset().mockResolvedValue({ ok: true, error: null })
    Object.defineProperty(window, "location", {
      value: { href: "" },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
      configurable: true,
    })
  })

  const cases: Array<[string, string | null, string]> = [
    ["URL absoluta de otro origen", "https://evil.com", FALLBACK],
    ["esquema javascript:", "javascript:alert(1)", FALLBACK],
    ["URL protocol-relative", "//evil.com", FALLBACK],
    ["barra invertida de navegador", "/\\evil.com", FALLBACK],
    ["ruta propia valida", "/superadmin/organizaciones", "/superadmin/organizaciones"],
    ["ruta propia con query", "/superadmin/organizaciones?page=2", "/superadmin/organizaciones?page=2"],
    ["parametro ausente", null, FALLBACK],
    ["parametro vacio", "", FALLBACK],
  ]

  it.each(cases)("credenciales: %s", async (_label, raw, expected) => {
    setCallbackUrl(raw)
    render(<SuperadminLoginPage />)

    await submitCredentials()

    await waitFor(() => expect(window.location.href).toBe(expected))
  })

  it.each(cases)("2FA: %s", async (_label, raw, expected) => {
    setCallbackUrl(raw)
    signInMock
      .mockResolvedValueOnce({ ok: false, error: "CredentialsSignin", code: "REQUIRES_2FA:user-1" })
      .mockResolvedValueOnce({ ok: true, error: null })
    render(<SuperadminLoginPage />)

    await submitCredentials()
    fireEvent.click(await screen.findByRole("button", { name: "verificar-2fa" }))

    await waitFor(() => expect(window.location.href).toBe(expected))
  })
})
