import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { TextoConEnlaces } from "@/components/soporte/texto-con-enlaces"

describe("TextoConEnlaces", () => {
  it("convierte una URL https en enlace que abre aparte, sin la puntuación final", () => {
    render(<p><TextoConEnlaces texto="Entrá a https://play.google.com/apps/testing/ar.com.stapp.app. Gracias" /></p>)
    const enlace = screen.getByRole("link")
    expect(enlace).toHaveAttribute("href", "https://play.google.com/apps/testing/ar.com.stapp.app")
    expect(enlace).toHaveAttribute("target", "_blank")
    expect(enlace).toHaveAttribute("rel", "noopener noreferrer")
    expect(screen.getByText(/Gracias/)).toBeInTheDocument()
  })

  it("no arma enlaces con otros esquemas ni interpreta HTML", () => {
    const { container } = render(<p><TextoConEnlaces texto={'javascript:alert(1) <a href="x">hola</a>'} /></p>)
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
    expect(container.querySelector("a")).toBeNull()
  })

  it("texto sin enlaces queda igual", () => {
    render(<p data-testid="p"><TextoConEnlaces texto={"hola\nmundo"} /></p>)
    expect(screen.getByTestId("p").textContent).toBe("hola\nmundo")
  })
})
