// __tests__/components/orden-form-dispositivo-error.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null }),
}))

vi.mock("@/hooks/use-tipos-dispositivo", () => ({
  useTiposDispositivo: () => ({ tipos: [], loading: false, error: null, refetch: vi.fn() }),
}))

describe("OrdenForm — el error de 'dispositivo' y 'problema reportado' se limpia al tipear", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: async () => [] } as Response)),
    )
  })

  it("al hacer click en Siguiente sin completar nada, marca ambos como requeridos; tipear cada uno limpia solo su propio error", async () => {
    const { OrdenForm } = await import("@/components/ordenes/orden-form")
    render(
      <ModalProvider>
        <OrdenForm onClose={vi.fn()} onSuccess={vi.fn()} />
      </ModalProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }))

    expect(await screen.findByText("El dispositivo es requerido")).toBeInTheDocument()
    expect(await screen.findByText("El problema es requerido")).toBeInTheDocument()

    // Bug original: mode por defecto es "onSubmit" y el input de dispositivo
    // sólo usaba `register("dispositivo")` sin onChange — el error quedaba
    // visible aunque el usuario ya hubiera tipeado un valor.
    fireEvent.change(screen.getByPlaceholderText("Modelo o descripcion del equipo"), {
      target: { value: "iPhone 12" },
    })
    await waitFor(() =>
      expect(screen.queryByText("El dispositivo es requerido")).not.toBeInTheDocument(),
    )
    // El error del campo hermano (mismo paso, mismo bug potencial) sigue,
    // porque todavia no se tipeo ahi.
    expect(screen.getByText("El problema es requerido")).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText("Describa el problema del equipo..."), {
      target: { value: "No enciende" },
    })
    await waitFor(() =>
      expect(screen.queryByText("El problema es requerido")).not.toBeInTheDocument(),
    )
  })
})
