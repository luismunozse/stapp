import { describe, it, expect, vi } from "vitest"
import { render } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"
import { ClienteForm } from "@/components/clientes/cliente-form"

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { role: "ADMIN" } } }),
}))

let mockPais = "ES"
vi.mock("@/contexts/currency-context", async (orig) => ({
  ...(await orig<typeof import("@/contexts/currency-context")>()),
  useCurrency: () => ({ pais: mockPais }),
}))

function renderForm() {
  return render(
    <ModalProvider>
      <ClienteForm open onClose={vi.fn()} onSuccess={vi.fn()} />
    </ModalProvider>,
  )
}

describe("ClienteForm — teclado de los campos de ID segun el pais", () => {
  it("ES: el DNI/NIE admite letras (teclado de texto, mayusculas)", () => {
    mockPais = "ES"
    renderForm()
    const dni = document.getElementById("dni") as HTMLInputElement
    expect(dni.getAttribute("inputmode")).toBe("text")
    expect(dni.getAttribute("autocapitalize")).toBe("characters")
  })

  it("AR: el DNI mantiene el teclado numerico", () => {
    mockPais = "AR"
    renderForm()
    const dni = document.getElementById("dni") as HTMLInputElement
    expect(dni.getAttribute("inputmode")).toBe("numeric")
    expect(dni.getAttribute("autocapitalize")).toBeNull()
  })
})
