// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

let rol = "ADMIN"
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "u1", role: rol } } }) }))

import { ClienteNotasCreditoLink } from "@/components/clientes/detalle/cliente-notas-credito-link"

describe("ClienteNotasCreditoLink", () => {
  it("el ADMIN llega al listado filtrado por el cliente", () => {
    rol = "ADMIN"
    render(<ClienteNotasCreditoLink clienteId="cli-1" />)
    expect(screen.getByRole("link", { name: /notas de crédito/i })).toHaveAttribute("href", "/notas-credito?cliente=cli-1")
  })

  it.each(["VENDEDOR", "TECNICO"])("%s no ve el link (no entra al listado)", (role) => {
    rol = role
    render(<ClienteNotasCreditoLink clienteId="cli-1" />)
    expect(screen.queryByRole("link", { name: /notas de crédito/i })).not.toBeInTheDocument()
  })
})
