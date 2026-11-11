import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"

const confirm = vi.fn()
const showSuccess = vi.fn()
const showError = vi.fn()
const mutate = vi.fn()

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { role: "ADMIN" } } }),
}))
vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ confirm, showSuccess, showError }),
}))
vi.mock("@/components/vendedores/vendedor-form", () => ({ VendedorForm: () => null }))
vi.mock("swr", () => ({
  default: () => ({
    data: {
      data: [
        {
          id: "v1",
          nombre: "Ana Ventas",
          email: "ana@x.com",
          telefono: null,
          activo: true,
          porcentajeComision: 5,
          created_at: "2026-01-01",
          ventasCompletadas: 3,
          ventasTotal: 3,
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    },
    isLoading: false,
    mutate,
  }),
}))

import { VendedoresList } from "@/components/vendedores/vendedores-list"

describe("VendedoresList: eliminar un vendedor con ventas", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("no lo bloquea: llama a la API y muestra el aviso de baja", async () => {
    confirm.mockResolvedValue(true)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ baja: true, message: "El vendedor tenía historial: quedó dado de baja." }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<VendedoresList />)
    fireEvent.click(screen.getByRole("button", { name: "Eliminar Ana Ventas" }))

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining("quedará dado de baja") })
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/vendedores/v1", { method: "DELETE" }))
    await waitFor(() => expect(showSuccess).toHaveBeenCalledWith("El vendedor tenía historial: quedó dado de baja."))
    expect(mutate).toHaveBeenCalled()
    expect(showError).not.toHaveBeenCalled()
  })

  it("si cancela la confirmación no llama a la API", async () => {
    confirm.mockResolvedValue(false)
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    render(<VendedoresList />)
    fireEvent.click(screen.getByRole("button", { name: "Eliminar Ana Ventas" }))

    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
