// __tests__/components/orden-repuestos-tab.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"
import { OrdenRepuestosTab } from "@/components/ordenes/orden-repuestos-tab"

describe("OrdenRepuestosTab — espera el refetch del padre antes de reactivar el formulario", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("mantiene el boton 'Agregar' deshabilitado hasta que onRepuestosChanged resuelve", async () => {
    let resolveOrdenChanged: () => void = () => {}
    const onRepuestosChanged = vi.fn(
      () => new Promise<void>((resolve) => { resolveOrdenChanged = resolve }),
    )

    const mockFetch = vi.fn((url: string, opts?: RequestInit) => {
      const method = opts?.method ?? "GET"
      if (typeof url === "string" && url.includes("/api/inventario")) {
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
      }
      if (typeof url === "string" && url.includes("/repuestos") && method === "POST") {
        return Promise.resolve({ ok: true, json: async () => ({}) } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response)
    })
    vi.stubGlobal("fetch", mockFetch)

    render(
      <ModalProvider>
        <OrdenRepuestosTab ordenId="orden-1" repuestos={[]} onRepuestosChanged={onRepuestosChanged} />
      </ModalProvider>,
    )

    // Abrir el formulario y usar la pestana "Manual" (evita depender del
    // fetch de inventario para completar el Select).
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }))
    fireEvent.click(screen.getByRole("button", { name: "Manual" }))

    fireEvent.change(screen.getByPlaceholderText("Ej: Flex de carga iPhone 12"), {
      target: { value: "Pantalla" },
    })
    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "100" },
    })

    // Enviar: dispara el POST y, al resolver ok, espera onRepuestosChanged.
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }))

    await waitFor(() => expect(onRepuestosChanged).toHaveBeenCalledTimes(1))

    // Mientras onRepuestosChanged sigue pendiente, el boton de envio y el
    // formulario deben seguir visibles/deshabilitados (sin cerrar el form
    // ni permitir un segundo click que duplique el alta).
    const submitButton = screen.getByRole("button", { name: "Agregar" })
    expect(submitButton).toBeDisabled()
    expect(screen.getByPlaceholderText("Ej: Flex de carga iPhone 12")).toBeInTheDocument()

    // Resolver el refetch del padre: recien ahi se cierra el formulario.
    await act(async () => {
      resolveOrdenChanged()
      await Promise.resolve()
    })

    await waitFor(() =>
      expect(screen.queryByPlaceholderText("Ej: Flex de carga iPhone 12")).not.toBeInTheDocument(),
    )
    expect(screen.getByRole("button", { name: "Agregar" })).not.toBeDisabled()
  })
})
