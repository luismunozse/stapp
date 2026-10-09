import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { ClienteDetalleDatos } from "@/components/clientes/detalle/cliente-detalle-datos"

let pais: string | undefined
vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ pais }),
}))

const cliente = {
  telefono: "600123123",
  dni: "12345678Z",
  cuit: "B12345678",
  razonSocial: "Taller SL",
  aceptaWhatsapp: true,
} as any

describe("ClienteDetalleDatos — etiquetas de ID por país", () => {
  beforeEach(() => {
    pais = undefined
  })

  it("Argentina: DNI y CUIT", () => {
    pais = "AR"
    render(<ClienteDetalleDatos cliente={cliente} />)
    expect(screen.getByText("DNI:")).toBeInTheDocument()
    expect(screen.getByText("CUIT:")).toBeInTheDocument()
  })

  it("España: DNI/NIE y NIF, sin CUIT", () => {
    pais = "ES"
    render(<ClienteDetalleDatos cliente={cliente} />)
    expect(screen.getByText("DNI/NIE:")).toBeInTheDocument()
    expect(screen.getByText("NIF:")).toBeInTheDocument()
    expect(screen.queryByText("CUIT:")).not.toBeInTheDocument()
  })
})
