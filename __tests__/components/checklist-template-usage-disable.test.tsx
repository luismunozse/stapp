// __tests__/components/checklist-template-usage-disable.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"

vi.mock("@/hooks/use-tipos-dispositivo", () => ({
  useTiposDispositivo: () => ({ tipos: [] }),
}))

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

const usedTemplate = {
  id: "t1",
  nombre: "Recepcion estandar",
  activo: true,
  items: [],
  tipoDispositivoId: null,
  tipoDispositivo: null,
  _count: { checklists: 2 },
}

describe("TemplateEditor — template en uso", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue({ ok: true, json: async () => [usedTemplate] })
  })

  it("deshabilita el borrado y muestra el conteo de usos", async () => {
    const { TemplateEditor } = await import("@/components/checklist/template-editor")
    render(
      <ModalProvider>
        <TemplateEditor />
      </ModalProvider>
    )

    const deleteBtn = await screen.findByRole("button", { name: /eliminar template/i })
    expect(deleteBtn).toBeDisabled()

    await waitFor(() =>
      expect(
        screen.getByText(
          (_, el) =>
            el?.tagName === "P" && (el.textContent?.includes("Usado en 2 orden(es)") ?? false)
        )
      ).toBeInTheDocument()
    )
  })
})
