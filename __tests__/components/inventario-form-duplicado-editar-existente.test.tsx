import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { InventarioForm } from "@/components/inventario/inventario-form"

/**
 * "Editar este", on the duplicate-product warning, used to be a one-click
 * wipe.
 *
 * The button asks the parent to load the existing product, and the parent
 * answers by flipping this form's `item` prop from null to an object -- which
 * fires the reset() effect and replaces every field the operator had typed for
 * the NEW product. No confirmation, no undo. The warning itself only appears
 * AFTER a name has been typed and blurred, so by construction there is always
 * work on screen when that button is reachable.
 *
 * The repo already treats this shape of action as destructive and confirms it
 * (DraftRestoredNotice / useModal().confirm), so this one does too: the
 * operator either keeps what they typed or hands the screen over knowingly.
 *
 * Since the form persists drafts (hooks/use-form-draft.ts), handing the screen
 * over is no longer a loss: the flip changes the draft key from `new` to
 * `edit:{id}` and the hook flushes what is pending BEFORE switching, so the
 * half-loaded product stays in its own entry. The confirmation stays -- the
 * screen still changes under the operator's hands -- but it now says what
 * actually happens. See inventario-form-draft.test.tsx for the persistence side.
 */

const { confirmMock, showErrorMock } = vi.hoisted(() => ({
  confirmMock: vi.fn(),
  showErrorMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({
    confirm: confirmMock,
    alert: vi.fn().mockResolvedValue(undefined),
    showSuccess: vi.fn().mockResolvedValue(undefined),
    showError: showErrorMock,
    showWarning: vi.fn().mockResolvedValue(undefined),
    showInfo: vi.fn().mockResolvedValue(undefined),
  }),
}))

// El formulario persiste borradores y el hook arma la key con la sesion.
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

const MATCH = {
  id: "existente-1",
  codigo: "CEL-0001",
  nombre: "Batería iPhone 12",
  categoria: "Baterías",
  tipoDispositivo: "CELULAR",
  stock: 4,
  precioCompra: 100,
  precioVenta: 200,
  proveedor: null,
  score: 0.9,
}

describe("InventarioForm — 'Editar este' sobre un duplicado detectado", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    // El formulario persiste borradores: sin esto, uno escrito por un test
    // anterior se restaura sobre el siguiente y lo hace medir otra cosa.
    window.localStorage.clear()
    fetchMock = vi.fn((url: string) => {
      if (typeof url === "string" && url.includes("/api/inventario/check-duplicate")) {
        return Promise.resolve({ ok: true, json: async () => ({ matches: [MATCH] }) } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => [] } as Response)
    })
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** Escribe un nombre y dispara el chequeo de duplicados (corre on blur). */
  async function mostrarDuplicado(onEditExisting: (id: string) => void) {
    render(
      <InventarioForm onClose={vi.fn()} onSuccess={vi.fn()} onEditExisting={onEditExisting} />,
    )
    const nombre = screen.getByLabelText("Nombre *")
    fireEvent.change(nombre, { target: { value: "Bateria iPhone 12 original" } })
    fireEvent.blur(nombre)

    return await screen.findByRole("button", { name: /editar este/i })
  }

  it("pide confirmación antes de reemplazar lo que el operador escribió", async () => {
    confirmMock.mockResolvedValue(false)
    const onEditExisting = vi.fn()

    const boton = await mostrarDuplicado(onEditExisting)
    fireEvent.click(boton)

    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
  })

  it("no toca el formulario si el operador cancela", async () => {
    confirmMock.mockResolvedValue(false)
    const onEditExisting = vi.fn()

    const boton = await mostrarDuplicado(onEditExisting)
    fireEvent.click(boton)

    await waitFor(() => expect(confirmMock).toHaveBeenCalled())
    expect(onEditExisting).not.toHaveBeenCalled()
    // Lo escrito sigue donde estaba.
    expect(screen.getByLabelText("Nombre *")).toHaveValue("Bateria iPhone 12 original")
  })

  it("abre el existente cuando el operador acepta entregar la pantalla", async () => {
    confirmMock.mockResolvedValue(true)
    const onEditExisting = vi.fn()

    const boton = await mostrarDuplicado(onEditExisting)
    fireEvent.click(boton)

    await waitFor(() => expect(onEditExisting).toHaveBeenCalledWith("existente-1"))
  })

  it("dice en el diálogo qué pasa con lo cargado para el producto nuevo", async () => {
    confirmMock.mockResolvedValue(false)

    const boton = await mostrarDuplicado(vi.fn())
    fireEvent.click(boton)

    await waitFor(() => expect(confirmMock).toHaveBeenCalled())
    const opciones = confirmMock.mock.calls[0][0]
    // Prometer una pérdida que ya no ocurre es tan malo como ocultarla: enseña
    // a desconfiar del resto de los avisos. Lo cargado queda como borrador.
    expect(opciones.description).toMatch(/borrador/i)
    expect(opciones.description).not.toMatch(/perder/i)
    // Cancelar tiene que ser la salida obvia, no un "Cancelar" genérico.
    expect(opciones.cancelText).toBeTruthy()
    expect(opciones.confirmText).toBeTruthy()
  })
})

/**
 * "Sumar stock", el botón de al lado, descarta el formulario igual de rápido:
 * suma la cantidad al item existente y llama a onSuccess(), que lo cierra —
 * nombre, precios, ubicación, imagen pendiente, todo lo cargado para el producto
 * nuevo se va con él.
 *
 * Estaba anotado como deuda deliberada mientras "Editar este" tampoco
 * preguntaba. Ahora que el de al lado sí, la inconsistencia queda a la vista en
 * una sola fila de la UI: dos botones pegados, uno pregunta y el otro no.
 */
describe("InventarioForm — 'Sumar stock' sobre un duplicado detectado", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock = vi.fn((url: string) => {
      if (typeof url === "string" && url.includes("/api/inventario/check-duplicate")) {
        return Promise.resolve({ ok: true, json: async () => ({ matches: [MATCH] }) } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => [] } as Response)
    })
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** Nombre + stock cargados, que es lo mínimo para que consolidar tenga sentido. */
  async function mostrarDuplicadoConStock(onSuccess: () => void) {
    render(<InventarioForm onClose={vi.fn()} onSuccess={onSuccess} onEditExisting={vi.fn()} />)
    const nombre = screen.getByLabelText("Nombre *")
    fireEvent.change(nombre, { target: { value: "Bateria iPhone 12 original" } })
    fireEvent.change(screen.getByLabelText("Stock *"), { target: { value: "3" } })
    fireEvent.blur(nombre)

    return await screen.findByRole("button", { name: /sumar stock/i })
  }

  it("pide confirmación antes de descartar lo cargado", async () => {
    confirmMock.mockResolvedValue(false)

    const boton = await mostrarDuplicadoConStock(vi.fn())
    fireEvent.click(boton)

    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
    expect(confirmMock.mock.calls[0][0].description).toMatch(/perder|pierde/i)
  })

  it("no suma nada si el operador cancela", async () => {
    confirmMock.mockResolvedValue(false)
    const onSuccess = vi.fn()

    const boton = await mostrarDuplicadoConStock(onSuccess)
    fireEvent.click(boton)

    await waitFor(() => expect(confirmMock).toHaveBeenCalled())
    expect(onSuccess).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls.some(([, init]: any[]) => init?.method === "POST")).toBe(false)
    expect(screen.getByLabelText("Nombre *")).toHaveValue("Bateria iPhone 12 original")
  })

  it("suma cuando el operador acepta", async () => {
    confirmMock.mockResolvedValue(true)
    const onSuccess = vi.fn()

    const boton = await mostrarDuplicadoConStock(onSuccess)
    fireEvent.click(boton)

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    const post = fetchMock.mock.calls.find(([, init]: any[]) => init?.method === "POST")
    expect(post![0]).toContain("/api/inventario/existente-1/stock")
  })
})
