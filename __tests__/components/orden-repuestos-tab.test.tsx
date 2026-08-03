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
    fireEvent.change(screen.getByLabelText("Costo unitario"), {
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

    // Resolver el refetch del padre: recien ahi se reactivan los controles.
    await act(async () => {
      resolveOrdenChanged()
      await Promise.resolve()
    })

    // El formulario NO se cierra (carga en lote), pero queda limpio y operable
    // para el siguiente repuesto.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Agregar" })).not.toBeDisabled(),
    )
    expect(screen.getByPlaceholderText("Ej: Flex de carga iPhone 12")).toHaveValue("")
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

  it("deja el formulario abierto tras agregar, para cargar varios seguidos", async () => {
    setupFetch([item()])
    const onRepuestosChanged = vi.fn().mockResolvedValue(undefined)

    render(
      <ModalProvider>
        <OrdenRepuestosTab ordenId="orden-1" repuestos={[]} onRepuestosChanged={onRepuestosChanged} />
      </ModalProvider>,
    )

    abrirBuscador()
    fireEvent.click(await screen.findByText("Pantalla iPhone 12"))
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }))

    // El buscador sigue montado y aparece la confirmacion del alta anterior.
    expect(await screen.findByText(/Agregado: Pantalla iPhone 12/)).toBeInTheDocument()
    expect(screen.getByRole("combobox")).toBeInTheDocument()
  })
})

describe("OrdenRepuestosTab — costo y precio de venta en repuestos manuales", () => {
  const setupFetch = () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response),
    )
    vi.stubGlobal("fetch", mockFetch)
    return mockFetch
  }

  const abrirManual = () => {
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }))
    fireEvent.click(screen.getByRole("button", { name: "Manual" }))
  }

  const postBody = (mockFetch: ReturnType<typeof vi.fn>) => {
    const call = mockFetch.mock.calls.find(
      ([, opts]) => (opts as RequestInit | undefined)?.method === "POST",
    )
    return call ? JSON.parse((call[1] as RequestInit).body as string) : null
  }

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("manda los dos precios por separado", async () => {
    const mockFetch = setupFetch()

    render(
      <ModalProvider>
        <OrdenRepuestosTab
          ordenId="orden-1"
          repuestos={[]}
          onRepuestosChanged={vi.fn().mockResolvedValue(undefined)}
        />
      </ModalProvider>,
    )

    abrirManual()
    fireEvent.change(screen.getByLabelText("Nombre del repuesto"), { target: { value: "Flex" } })
    fireEvent.change(screen.getByLabelText("Costo unitario"), { target: { value: "3000" } })
    fireEvent.change(screen.getByLabelText("Precio de venta"), { target: { value: "8000" } })
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }))

    await waitFor(() => {
      expect(postBody(mockFetch)).toMatchObject({
        tipo: "manual",
        nombre: "Flex",
        precioUnitario: 3000,
        precioVentaUnitario: 8000,
      })
    })
  })

  it("avisa cuando el precio de venta queda por debajo del costo", () => {
    setupFetch()

    render(
      <ModalProvider>
        <OrdenRepuestosTab ordenId="orden-1" repuestos={[]} onRepuestosChanged={vi.fn()} />
      </ModalProvider>,
    )

    abrirManual()
    fireEvent.change(screen.getByLabelText("Costo unitario"), { target: { value: "5000" } })
    fireEvent.change(screen.getByLabelText("Precio de venta"), { target: { value: "3000" } })

    expect(screen.getByText(/por debajo del costo/i)).toBeInTheDocument()
  })

  it("omite el precio de venta si no se completa: el servidor usa el costo", async () => {
    const mockFetch = setupFetch()

    render(
      <ModalProvider>
        <OrdenRepuestosTab
          ordenId="orden-1"
          repuestos={[]}
          onRepuestosChanged={vi.fn().mockResolvedValue(undefined)}
        />
      </ModalProvider>,
    )

    abrirManual()
    fireEvent.change(screen.getByLabelText("Nombre del repuesto"), { target: { value: "Tornillo" } })
    fireEvent.change(screen.getByLabelText("Costo unitario"), { target: { value: "500" } })
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }))

    await waitFor(() => {
      const body = postBody(mockFetch)
      expect(body).toMatchObject({ precioUnitario: 500 })
      expect(body.precioVentaUnitario).toBeUndefined()
    })
  })
})

describe("OrdenRepuestosTab — stepper de cantidad", () => {
  const repuestoCargado = {
    id: "rep-1",
    inventarioId: "inv-1",
    inventario: { id: "inv-1", nombre: "Pantalla iPhone 12", stock: 5 },
    cantidad: 2,
    precioUnitario: 100,
  }

  const setupFetch = () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response),
    )
    vi.stubGlobal("fetch", mockFetch)
    return mockFetch
  }

  const patchCalls = (mockFetch: ReturnType<typeof vi.fn>) =>
    mockFetch.mock.calls.filter(
      ([, opts]) => (opts as RequestInit | undefined)?.method === "PATCH",
    )

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("manda un PATCH con la cantidad nueva al tocar +", async () => {
    const mockFetch = setupFetch()
    const onRepuestosChanged = vi.fn().mockResolvedValue(undefined)

    render(
      <ModalProvider>
        <OrdenRepuestosTab
          ordenId="orden-1"
          repuestos={[repuestoCargado]}
          ordenEstado="EN_REPARACION"
          onRepuestosChanged={onRepuestosChanged}
        />
      </ModalProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: /Agregar una unidad/ }))

    await waitFor(
      () => {
        const calls = patchCalls(mockFetch)
        expect(calls.length).toBe(1)
        expect(JSON.parse((calls[0][1] as RequestInit).body as string)).toEqual({ cantidad: 3 })
      },
      { timeout: 3000 },
    )
  })

  it("agrupa clicks rapidos en un unico PATCH con la cantidad final", async () => {
    const mockFetch = setupFetch()

    render(
      <ModalProvider>
        <OrdenRepuestosTab
          ordenId="orden-1"
          repuestos={[repuestoCargado]}
          ordenEstado="EN_REPARACION"
          onRepuestosChanged={vi.fn().mockResolvedValue(undefined)}
        />
      </ModalProvider>,
    )

    const mas = screen.getByRole("button", { name: /Agregar una unidad/ })
    fireEvent.click(mas)
    fireEvent.click(mas)
    fireEvent.click(mas)

    await waitFor(
      () => {
        const calls = patchCalls(mockFetch)
        expect(calls.length).toBe(1)
        expect(JSON.parse((calls[0][1] as RequestInit).body as string)).toEqual({ cantidad: 5 })
      },
      { timeout: 3000 },
    )
  })

  it("no permite bajar de 1", () => {
    setupFetch()

    render(
      <ModalProvider>
        <OrdenRepuestosTab
          ordenId="orden-1"
          repuestos={[{ ...repuestoCargado, cantidad: 1 }]}
          ordenEstado="EN_REPARACION"
          onRepuestosChanged={vi.fn()}
        />
      </ModalProvider>,
    )

    expect(screen.getByRole("button", { name: /Quitar una unidad/ })).toBeDisabled()
  })

  it("oculta el stepper en una orden entregada (la reserva ya se consumio)", () => {
    setupFetch()

    render(
      <ModalProvider>
        <OrdenRepuestosTab
          ordenId="orden-1"
          repuestos={[repuestoCargado]}
          ordenEstado="ENTREGADO"
          onRepuestosChanged={vi.fn()}
        />
      </ModalProvider>,
    )

    expect(screen.queryByRole("button", { name: /Agregar una unidad/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Quitar una unidad/ })).not.toBeInTheDocument()
  })

  it("oculta el stepper en una orden cancelada", () => {
    setupFetch()

    render(
      <ModalProvider>
        <OrdenRepuestosTab
          ordenId="orden-1"
          repuestos={[repuestoCargado]}
          ordenEstado="CANCELADO"
          onRepuestosChanged={vi.fn()}
        />
      </ModalProvider>,
    )

    expect(screen.queryByRole("button", { name: /Agregar una unidad/ })).not.toBeInTheDocument()
  })
})
