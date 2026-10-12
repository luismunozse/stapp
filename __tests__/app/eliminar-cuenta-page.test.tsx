import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import EliminarCuentaPage, { metadata } from "@/app/legal/eliminar-cuenta/page"
import { CONTACT_EMAIL } from "@/lib/contact"
import { GRACE_DAYS } from "@/lib/account-deletion/state"

describe("/legal/eliminar-cuenta", () => {
  it("se renderiza sin sesión con el formulario, el plazo y el contacto", () => {
    render(<EliminarCuentaPage />)
    expect(screen.getByRole("heading", { level: 1, name: /eliminar mi cuenta/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/subdominio/i)).toBeInTheDocument()
    expect(screen.getByText(new RegExp(`${GRACE_DAYS} días`))).toBeInTheDocument()
    expect(screen.getByRole("link", { name: CONTACT_EMAIL })).toHaveAttribute("href", `mailto:${CONTACT_EMAIL}`)
  })

  it("declara su propio canonical", () => {
    expect(metadata.alternates?.canonical).toBe("https://stapp.com.ar/legal/eliminar-cuenta")
  })
})
