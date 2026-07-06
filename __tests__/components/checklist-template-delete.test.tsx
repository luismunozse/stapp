// __tests__/components/checklist-template-delete.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"

// Sin tipos de dispositivo para evitar fetches extra en el montaje
vi.mock("@/hooks/use-tipos-dispositivo", () => ({
  useTiposDispositivo: () => ({ tipos: [] }),
}))

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

const template = {
  id: "t1",
  nombre: "Recepcion estandar",
  activo: true,
  items: [],
  tipoDispositivoId: null,
  tipoDispositivo: null,
}

describe("TemplateEditor — borrar template", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      const method = opts?.method ?? "GET"
      if (url.includes("/api/checklist-templates") && method === "GET") {
        return Promise.resolve({ ok: true, json: async () => [template] })
      }
      if (method === "DELETE") {
        // Backend bloquea: el template ya se uso en recepciones
        return Promise.resolve({
          ok: false,
          status: 400,
          json: async () => ({
            error: "No se puede eliminar: hay 2 checklist(s) usando este template",
          }),
        })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
  })

  it("muestra el mensaje de error cuando el DELETE devuelve 400", async () => {
    const { TemplateEditor } = await import("@/components/checklist/template-editor")
    render(
      <ModalProvider>
        <TemplateEditor />
      </ModalProvider>
    )

    // Espera a que cargue el template
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /eliminar template/i })).toBeInTheDocument()
    )

    // Dispara el borrado y confirma en el ConfirmDialog
    fireEvent.click(screen.getByRole("button", { name: /eliminar template/i }))
    fireEvent.click(await screen.findByRole("button", { name: "Eliminar" }))

    // El error del backend debe ser visible para el usuario (no tragado en silencio)
    expect(await screen.findByText(/no se puede eliminar/i)).toBeInTheDocument()
  })
})
