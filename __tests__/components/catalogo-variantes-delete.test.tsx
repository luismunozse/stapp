// __tests__/components/catalogo-variantes-delete.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const mockFetch = vi.fn()
global.fetch = mockFetch

describe("CatalogoVariantesEditor — borrar variante", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ variantes: [{ id: "v1", etiqueta: "Rojo", sku: null, precio: null, stock: null, imagen_url: null, activo: true, orden: 0 }] }),
    })
  })

  it("no usa window.confirm y borra vía ConfirmDialog", async () => {
    const confirmSpy = vi.spyOn(window, "confirm")
    const { CatalogoVariantesEditor } = await import("@/components/catalogo/catalogo-variantes-editor")
    render(<CatalogoVariantesEditor itemId="item-1" />)

    await waitFor(() => expect(screen.getByText("Rojo")).toBeInTheDocument())

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })

    fireEvent.click(screen.getByRole("button", { name: /eliminar variante/i }))
    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }))

    await waitFor(() => expect(screen.queryByText("Rojo")).not.toBeInTheDocument())
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})
