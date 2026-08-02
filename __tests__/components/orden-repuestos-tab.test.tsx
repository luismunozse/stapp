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

describe("OrdenRepuestosTab — busqueda de repuestos del inventario", () => {
  const item = (over: Partial<Record<string, unknown>> = {}) => ({
    id: "inv-1",
    codigo: "PANT-001",
    nombre: "Pantalla iPhone 12",
    stock: 5,
    stockReservado: 1,
    precioCompra: 100,
    ...over,
  })

  /** Devuelve el mock de fetch y las URLs de inventario consultadas. */
  const setupFetch = (rows: Array<Record<string, unknown>>) => {
    const inventarioUrls: string[] = []
    const mockFetch = vi.fn((url: string, opts?: RequestInit) => {
      const method = opts?.method ?? "GET"
      if (typeof url === "string" && url.includes("/api/inventario")) {
        inventarioUrls.push(url)
        return Promise.resolve({ ok: true, json: async () => ({ data: rows }) } as Response)
      }
      if (typeof url === "string" && url.includes("/repuestos") && method === "POST") {
        return Promise.resolve({ ok: true, json: async () => ({}) } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response)
    })
    vi.stubGlobal("fetch", mockFetch)
    return { mockFetch, inventarioUrls }
  }

  const abrirBuscador = () => {
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }))
    fireEvent.focus(screen.getByRole("combobox"))
  }

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("consulta al servidor con el termino tipeado en vez de filtrar una lista local", async () => {
    const { inventarioUrls } = setupFetch([item()])

    render(
      <ModalProvider>
        <OrdenRepuestosTab ordenId="orden-1" repuestos={[]} onRepuestosChanged={vi.fn()} />
      </ModalProvider>,
    )

    abrirBuscador()
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "pantalla" } })

    await waitFor(() =>
      expect(inventarioUrls.some((u) => u.includes("search=pantalla"))).toBe(true),
    )
    expect(await screen.findByText("Pantalla iPhone 12")).toBeInTheDocument()
    // Disponible = stock - reservado, igual que valida el RPC.
    expect(screen.getByText("4 disp.")).toBeInTheDocument()
  })

  it("envia el id del item seleccionado en el POST", async () => {
    const { mockFetch } = setupFetch([item()])
    const onRepuestosChanged = vi.fn().mockResolvedValue(undefined)

    render(
      <ModalProvider>
        <OrdenRepuestosTab ordenId="orden-1" repuestos={[]} onRepuestosChanged={onRepuestosChanged} />
      </ModalProvider>,
    )

    abrirBuscador()
    fireEvent.click(await screen.findByText("Pantalla iPhone 12"))
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }))

    await waitFor(() => {
      const post = mockFetch.mock.calls.find(
        ([, opts]) => (opts as RequestInit | undefined)?.method === "POST",
      )
      expect(post).toBeDefined()
      expect(JSON.parse((post![1] as RequestInit).body as string)).toEqual({
        tipo: "inventario",
        inventarioId: "inv-1",
        cantidad: 1,
      })
    })
  })

  it("no permite seleccionar un item sin stock disponible", async () => {
    setupFetch([item({ stock: 2, stockReservado: 2 })])

    render(
      <ModalProvider>
        <OrdenRepuestosTab ordenId="orden-1" repuestos={[]} onRepuestosChanged={vi.fn()} />
      </ModalProvider>,
    )

    abrirBuscador()
    const opcion = await screen.findByRole("option")
    expect(opcion).toHaveAttribute("aria-disabled", "true")
    expect(screen.getByText("Sin stock")).toBeInTheDocument()

    fireEvent.click(opcion)
    // Sigue en modo busqueda: no quedo seleccionado.
    expect(screen.getByRole("combobox")).toBeInTheDocument()
  })

  it("bloquea el alta cuando la cantidad supera el stock disponible", async () => {
    setupFetch([item()])

    render(
      <ModalProvider>
        <OrdenRepuestosTab ordenId="orden-1" repuestos={[]} onRepuestosChanged={vi.fn()} />
      </ModalProvider>,
    )

    abrirBuscador()
    fireEvent.click(await screen.findByText("Pantalla iPhone 12"))
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "9" } })

    expect(await screen.findByText(/Solo hay 4 disponible/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Agregar" })).toBeDisabled()
  })
})
