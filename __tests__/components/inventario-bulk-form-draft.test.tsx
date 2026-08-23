/**
 * Borrador local de la carga en lista (useFormDraft, hooks/use-form-draft.ts).
 *
 * Es la pantalla donde mas se escribe de una sentada: seis valores compartidos
 * arriba y una tabla de filas sin techo abajo. Perderla entera por un
 * vencimiento de sesion es media hora de trabajo.
 *
 * Dos particularidades:
 *
 *  - Las filas se identifican con `crypto.randomUUID()`. Ese id es una key de
 *    React, no un dato: no se persiste y se regenera al restaurar, asi que dos
 *    filas nunca pueden volver con el mismo id (lo que romperia editarlas y
 *    borrarlas) ni arrastrar una asociacion vieja.
 *  - No habia ningun <form> en la pantalla, y el gate de interaccion del hook
 *    solo cuenta controles que pertenecen a uno (o a una capa portalada que un
 *    <form> haya abierto). Sin eso, el borrador no se grababa NUNCA.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"
import { InventarioBulkForm } from "@/components/inventario/inventario-bulk-form"

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "user-1", organizationId: "org-1", role: "ADMIN" } },
    status: "authenticated",
  }),
}))

vi.mock("@/hooks/use-tipos-dispositivo", () => ({
  useTiposDispositivo: () => ({
    tipos: [{ id: "t1", codigo: "CELULAR", nombre: "Celular", config: null }],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

const KEY = "draft:v3:inventario-bulk-form:org-1:user-1:new"

function seedDraft(data: Record<string, unknown>) {
  window.localStorage.setItem(
    KEY,
    JSON.stringify({ version: 3, savedAt: Date.now(), data }),
  )
}

function draftDeLote(overrides: Record<string, unknown> = {}) {
  return {
    tipoDispositivo: "CELULAR",
    categoria: "Fundas",
    proveedorId: "",
    defaultStock: "5",
    defaultPrecioCompra: "100",
    defaultPrecioVenta: "250",
    rows: [
      { nombre: "Funda iPhone 15", stock: "5", precioCompra: "100", precioVenta: "250", barcode: "" },
      { nombre: "Funda iPhone 16", stock: "3", precioCompra: "100", precioVenta: "250", barcode: "" },
    ],
    ...overrides,
  }
}

function renderBulk(props: Partial<React.ComponentProps<typeof InventarioBulkForm>> = {}) {
  return render(
    <ModalProvider>
      <InventarioBulkForm onClose={vi.fn()} onSuccess={vi.fn()} {...props} />
    </ModalProvider>,
  )
}

describe("InventarioBulkForm — borrador local", () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: async () => [] } as unknown as Response)),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("restaura las filas cargadas y muestra el aviso dismissible", async () => {
    seedDraft(draftDeLote())

    renderBulk()

    expect(await screen.findByText(/se restauró un borrador no guardado/i)).toBeInTheDocument()
    expect(screen.getByDisplayValue("Funda iPhone 15")).toBeInTheDocument()
    expect(screen.getByDisplayValue("Funda iPhone 16")).toBeInTheDocument()
    // El contador del boton lee las filas con nombre: prueba que son 2 y no 3
    // filas en blanco.
    expect(screen.getByRole("button", { name: /Crear 2 productos/i })).toBeInTheDocument()
  })

  it("restaura los valores compartidos de arriba", async () => {
    seedDraft(draftDeLote())

    renderBulk()
    await screen.findByText(/se restauró un borrador no guardado/i)

    expect(screen.getByLabelText("Stock por defecto")).toHaveValue(5)
    expect(screen.getByLabelText("Precio compra por defecto")).toHaveValue(100)
    expect(screen.getByLabelText("Precio venta por defecto")).toHaveValue(250)
  })

  it("le da a cada fila restaurada un id propio", async () => {
    // Dos filas con el mismo id hacen que editar o borrar una toque a las dos.
    // Los ids no se persisten justamente para que no puedan volver repetidos.
    seedDraft(
      draftDeLote({
        rows: [
          { nombre: "Fila A", stock: "1", precioCompra: "", precioVenta: "", barcode: "" },
          { nombre: "Fila B", stock: "1", precioCompra: "", precioVenta: "", barcode: "" },
        ],
      }),
    )

    renderBulk()
    await screen.findByText(/se restauró un borrador no guardado/i)

    fireEvent.change(screen.getByDisplayValue("Fila A"), { target: { value: "Fila A editada" } })

    expect(screen.getByDisplayValue("Fila A editada")).toBeInTheDocument()
    expect(screen.getByDisplayValue("Fila B")).toBeInTheDocument()
  })

  it("descarta un borrador cuya forma ya no es la de esta pantalla", async () => {
    seedDraft({ tipoDispositivo: "CELULAR", rows: "no soy un array" })

    renderBulk()

    await waitFor(() => expect(window.localStorage.getItem(KEY)).toBeNull())
    expect(screen.queryByText(/se restauró un borrador no guardado/i)).not.toBeInTheDocument()
  })

  it("borra el borrador cuando el lote se crea entero", async () => {
    seedDraft(draftDeLote())
    const onSuccess = vi.fn()
    vi.stubGlobal(
      "fetch",
      vi.fn((url: unknown, init?: RequestInit) => {
        if (String(url).includes("bulk-create") && init?.method === "POST") {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ createdCount: 2, errors: [] }),
          } as Response)
        }
        return Promise.resolve({ ok: true, json: async () => [] } as unknown as Response)
      }),
    )

    renderBulk({ onSuccess })
    await screen.findByText(/se restauró un borrador no guardado/i)

    fireEvent.click(screen.getByRole("button", { name: /Crear 2 productos/i }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(2))
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })

  it("conserva el borrador cuando el lote falla", async () => {
    seedDraft(draftDeLote())
    vi.stubGlobal(
      "fetch",
      vi.fn((url: unknown, init?: RequestInit) => {
        if (String(url).includes("bulk-create") && init?.method === "POST") {
          return Promise.resolve({
            ok: false,
            status: 500,
            json: async () => ({ error: "Se cayo el server" }),
          } as Response)
        }
        return Promise.resolve({ ok: true, json: async () => [] } as unknown as Response)
      }),
    )

    renderBulk()
    await screen.findByText(/se restauró un borrador no guardado/i)

    fireEvent.click(screen.getByRole("button", { name: /Crear 2 productos/i }))

    await screen.findByText(/se cayo el server/i)
    expect(window.localStorage.getItem(KEY)).not.toBeNull()
  })

  it("conserva el borrador cuando solo una parte del lote entro", async () => {
    // 207: algunas filas quedaron con error y siguen en pantalla para
    // corregirlas. Borrar el borrador ahi seria perder justo lo que falta hacer.
    seedDraft(draftDeLote())
    const onSuccess = vi.fn()
    vi.stubGlobal(
      "fetch",
      vi.fn((url: unknown, init?: RequestInit) => {
        if (String(url).includes("bulk-create") && init?.method === "POST") {
          return Promise.resolve({
            ok: false,
            status: 207,
            json: async () => ({
              createdCount: 1,
              errors: [{ index: 1, nombre: "Funda iPhone 16", error: "Código duplicado" }],
            }),
          } as Response)
        }
        return Promise.resolve({ ok: true, json: async () => [] } as unknown as Response)
      }),
    )

    renderBulk({ onSuccess })
    await screen.findByText(/se restauró un borrador no guardado/i)

    fireEvent.click(screen.getByRole("button", { name: /Crear 2 productos/i }))

    await screen.findByText(/1 fila con error/i)
    expect(onSuccess).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(KEY)).not.toBeNull()
  })

  it("descarta el borrador y deja la pantalla en blanco", async () => {
    seedDraft(draftDeLote())

    renderBulk()
    await screen.findByText(/se restauró un borrador no guardado/i)

    fireEvent.click(screen.getByRole("button", { name: "Descartar" }))
    fireEvent.click(screen.getByRole("button", { name: "Descartar borrador" }))
    await act(async () => {})

    expect(screen.queryByText(/se restauró un borrador no guardado/i)).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue("Funda iPhone 15")).not.toBeInTheDocument()
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })
})

describe("InventarioBulkForm — borrador local (lo que se escribe)", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: async () => [] } as unknown as Response)),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("graba lo que el operador escribe en la tabla", async () => {
    // Sin un <form> alrededor, el gate de interaccion del hook no cuenta NINGUN
    // control de esta pantalla y no se graba nada.
    renderBulk()

    const nombres = screen.getAllByPlaceholderText("Ej: Funda iPhone 15 Pro")
    fireEvent.change(nombres[0], { target: { value: "Funda A" } })
    fireEvent.change(screen.getByLabelText("Stock por defecto"), { target: { value: "9" } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    const raw = window.localStorage.getItem(KEY)
    expect(raw).not.toBeNull()
    const data = JSON.parse(raw!).data
    expect(data.defaultStock).toBe("9")
    expect(data.rows[0].nombre).toBe("Funda A")
    // El id es una key de React, no un dato: se regenera al restaurar.
    expect(data.rows[0]).not.toHaveProperty("id")
  })
})
