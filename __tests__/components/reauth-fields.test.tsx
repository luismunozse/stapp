import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import {
  ReauthFields,
  EMPTY_REAUTH,
  isReauthComplete,
  toReauthPayload,
  reauthErrorMessage,
} from "@/components/perfil/reauth-fields"

describe("helpers de reautenticación", () => {
  it("usuario con contraseña: completa cuando hay password (y TOTP si corresponde)", () => {
    expect(isReauthComplete(EMPTY_REAUTH, true, false)).toBe(false)
    expect(isReauthComplete({ ...EMPTY_REAUTH, password: "x" }, true, false)).toBe(true)
    expect(isReauthComplete({ ...EMPTY_REAUTH, password: "x" }, true, true)).toBe(false)
    expect(isReauthComplete({ ...EMPTY_REAUTH, password: "x", totpCode: "123456" }, true, true)).toBe(true)
  })

  it("usuario Google: se pide el email, no la contraseña", () => {
    expect(isReauthComplete({ ...EMPTY_REAUTH, password: "x" }, false, false)).toBe(false)
    expect(isReauthComplete({ ...EMPTY_REAUTH, email: " a@b.com " }, false, false)).toBe(true)
  })

  it("el payload solo lleva lo que corresponde", () => {
    expect(toReauthPayload({ password: "p", email: "e@x.com", totpCode: "1" }, true, false)).toEqual({ password: "p" })
    expect(toReauthPayload({ password: "p", email: " e@x.com ", totpCode: " 123456 " }, false, true)).toEqual({ email: "e@x.com", totpCode: "123456" })
  })
})

describe("reauthErrorMessage", () => {
  it("reusa el mensaje del servidor cuando viene", () => {
    expect(reauthErrorMessage({ code: "ACCOUNT_LOCKED", error: "Demasiados intentos. Probá de nuevo más tarde." }))
      .toBe("Demasiados intentos. Probá de nuevo más tarde.")
  })

  it("tiene texto propio para cada código si el servidor no manda mensaje", () => {
    for (const code of ["WRONG_CREDENTIAL", "REQUIRES_2FA", "INVALID_2FA", "ACCOUNT_LOCKED"]) {
      expect(reauthErrorMessage({ code })).toBeTruthy()
    }
  })

  it("devuelve null si el código no es de reautenticación", () => {
    expect(reauthErrorMessage({ code: "OTHER", error: "x" })).toBeNull()
    expect(reauthErrorMessage({})).toBeNull()
  })
})

describe("<ReauthFields>", () => {
  const base = { value: EMPTY_REAUTH, onChange: vi.fn() }

  it("pide contraseña a quien tiene; no pide email ni código", () => {
    render(<ReauthFields {...base} hasPassword totpEnabled={false} />)
    expect(screen.getByLabelText(/contraseña/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/tu email/i)).toBeNull()
    expect(screen.queryByLabelText(/código/i)).toBeNull()
  })

  it("pide el email a quien usa Google y el código a quien tiene 2FA", () => {
    render(<ReauthFields {...base} hasPassword={false} totpEnabled />)
    expect(screen.getByLabelText(/tu email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/código/i)).toBeInTheDocument()
  })

  it("propaga los cambios sin pisar los otros campos", () => {
    const onChange = vi.fn()
    render(<ReauthFields value={{ ...EMPTY_REAUTH, totpCode: "9" }} onChange={onChange} hasPassword totpEnabled />)
    fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: "abc" } })
    expect(onChange).toHaveBeenCalledWith({ password: "abc", email: "", totpCode: "9" })
  })

  it("el campo de código es numérico de 6 dígitos con autocomplete one-time-code", () => {
    render(<ReauthFields {...base} hasPassword totpEnabled />)
    const totp = screen.getByLabelText(/código/i)
    expect(totp).toHaveAttribute("inputmode", "numeric")
    expect(totp).toHaveAttribute("autocomplete", "one-time-code")
    expect(totp).toHaveAttribute("maxlength", "6")
  })

  it("muestra el error en un alert", () => {
    render(<ReauthFields {...base} hasPassword totpEnabled={false} error="Contraseña incorrecta" />)
    expect(screen.getByRole("alert")).toHaveTextContent("Contraseña incorrecta")
  })
})
