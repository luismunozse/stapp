import { describe, it, expect, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { EliminarCuentaForm } from "@/components/legal/eliminar-cuenta-form"

describe("EliminarCuentaForm", () => {
  beforeEach(() => {
    Object.defineProperty(window, "location", { value: { href: "" }, writable: true, configurable: true })
  })

  it("con un subdominio válido lleva al login del taller", () => {
    render(<EliminarCuentaForm />)
    fireEvent.change(screen.getByLabelText(/subdominio/i), { target: { value: "Taller-Uno" } })
    fireEvent.click(screen.getByRole("button", { name: /ir a mi cuenta/i }))
    expect(window.location.href).toBe("https://taller-uno.stapp.com.ar/login?callbackUrl=%2Fperfil%23eliminar")
  })

  it("con un subdominio inválido muestra el error y no navega", () => {
    render(<EliminarCuentaForm />)
    fireEvent.change(screen.getByLabelText(/subdominio/i), { target: { value: "no valido!" } })
    fireEvent.click(screen.getByRole("button", { name: /ir a mi cuenta/i }))
    expect(screen.getByRole("alert")).toHaveTextContent(/letras, números y guiones/i)
    expect(window.location.href).toBe("")
  })

  it("vacío: pide el subdominio", () => {
    render(<EliminarCuentaForm />)
    fireEvent.click(screen.getByRole("button", { name: /ir a mi cuenta/i }))
    expect(screen.getByRole("alert")).toHaveTextContent(/ingrese/i)
    expect(window.location.href).toBe("")
  })
})
