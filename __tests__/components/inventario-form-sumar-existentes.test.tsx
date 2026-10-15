/**
 * "Sumar productos existentes": the product form's way into the grouping dialog (also the phone path).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { SWRConfig } from "swr"
import { InventarioForm } from "@/components/inventario/inventario-form"
import type { Inventario } from "@/types"

const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn() }))

vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({
    confirm: confirmMock,
    alert: vi.fn().mockResolvedValue(undefined),
    showSuccess: vi.fn().mockResolvedValue(undefined),
    showError: vi.fn().mockResolvedValue(undefined),
    showWarning: vi.fn().mockResolvedValue(undefined),
    showInfo: vi.fn().mockResolvedValue(undefined),
  }),
}))
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "user-1", organizationId: "org-1", role: "ADMIN" } }, status: "authenticated" }),
}))
vi.mock("@/hooks/use-tipos-dispositivo", () => ({
  useTiposDispositivo: () => ({ tipos: [{ id: "t1", codigo: "CELULAR", nombre: "Celular", config: null }], loading: false, error: null, refetch: vi.fn() }),
}))
vi.mock("@/lib/image-compression", () => ({ compressImage: async (file: File) => file }))
vi.mock("@/components/inventario/quick-stock-adjust", () => ({ QuickStockAdjust: () => null }))

const { propsElegir, propsAgrupar } = vi.hoisted(() => ({ propsElegir: [] as Record<string, any>[], propsAgrupar: [] as Record<string, any>[] }))
vi.mock("@/components/inventario/elegir-existentes-dialog", () => ({
  ElegirExistentesDialog: (props: Record<string, any>) => {
    propsElegir.push(props)
    return props.open ? <div data-testid="elegir" data-incluir={props.incluir?.id ?? ""} /> : null
  },
}))
vi.mock("@/components/inventario/agrupar-dialog", () => ({
  AgruparDialog: (props: Record<string, any>) => {
    propsAgrupar.push(props)
    return props.open ? <div data-testid="agrupar" data-ids={props.items.map((i: { id: string }) => i.id).join(",")} /> : null
  },
}))

const KEY_ALTA = "draft:v3:inventario-form:org-1:user-1:new"
const suelto = { id: "s1", codigo: "CEL-0001", nombre: "Funda suelta", categoria: "Baterías", tipoDispositivo: "CELULAR", stock: 5, stockReservado: 0, precioCompra: 80, precioVenta: 200 } as unknown as Inventario
const A = { ...suelto, id: "p1", nombre: "Funda roja" }
const B = { ...suelto, id: "p2", nombre: "Funda azul" }

describe("InventarioForm: Sumar productos existentes", () => {
  const onSuccess = vi.fn()
  const boton = () => screen.queryByRole("button", { name: "Sumar productos existentes" })

  beforeEach(() => {
    vi.clearAllMocks()
    confirmMock.mockResolvedValue(true)
    propsElegir.length = 0
    propsAgrupar.length = 0
    window.localStorage.clear()
    vi.stubGlobal(
      "fetch",
      vi.fn((url: unknown) => {
        const href = String(url)
        const body = href.includes("/api/depositos") ? { data: [] } : href.includes("next-code") ? { codigo: "CEL-0009" } : []
        return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response)
      })
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  function renderForm(props: Partial<React.ComponentProps<typeof InventarioForm>> = {}) {
    return render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <InventarioForm onClose={vi.fn()} onSuccess={onSuccess} {...props} />
      </SWRConfig>
    )
  }

  it("is offered in the variants section of a new product", async () => {
    renderForm({ permiteVariantes: true })
    expect(await screen.findByRole("button", { name: "Sumar productos existentes" })).toBeInTheDocument()
  })

  it("is not offered when variants are not allowed", async () => {
    renderForm()
    await screen.findByLabelText("Nombre *")
    expect(boton()).toBeNull()
  })

  it("is not offered once the section is on (the product is already being built)", async () => {
    renderForm({ permiteVariantes: true })
    fireEvent.click(await screen.findByRole("switch", { name: /este producto tiene variantes/i }))
    await waitFor(() => expect(boton()).toBeNull())
  })

  it("is not offered for a product that already belongs to a group", async () => {
    renderForm({ permiteVariantes: true, item: { ...suelto, grupoId: "g1", esKit: false } as Inventario })
    await screen.findByLabelText("Nombre *")
    expect(boton()).toBeNull()
  })

  it("is not offered for a kit", async () => {
    renderForm({ permiteVariantes: true, item: { ...suelto, esKit: true, tipoKit: "ENSAMBLADO" } as Inventario })
    await screen.findByLabelText("Nombre *")
    expect(boton()).toBeNull()
  })

  it("opens the picker with the product being edited already chosen", async () => {
    renderForm({ permiteVariantes: true, item: suelto })
    fireEvent.click(await screen.findByRole("button", { name: "Sumar productos existentes" }))
    expect((await screen.findByTestId("elegir")).getAttribute("data-incluir")).toBe("s1")
  })

  it("a new product opens the picker with nobody chosen", async () => {
    renderForm({ permiteVariantes: true })
    fireEvent.click(await screen.findByRole("button", { name: "Sumar productos existentes" }))
    expect((await screen.findByTestId("elegir")).getAttribute("data-incluir")).toBe("")
  })

  describe("unsaved work", () => {
    const PREGUNTA = "Lo que cargaste en este formulario no se guarda. ¿Seguís?"

    it("a clean form opens the picker directly, without asking", async () => {
      renderForm({ permiteVariantes: true })
      fireEvent.click(await screen.findByRole("button", { name: "Sumar productos existentes" }))
      expect(await screen.findByTestId("elegir")).toBeInTheDocument()
      expect(confirmMock).not.toHaveBeenCalled()
    })

    it("a form with typed data asks first, and opens the picker only if the user goes on", async () => {
      renderForm({ permiteVariantes: true })
      fireEvent.change(await screen.findByLabelText("Nombre *"), { target: { value: "Funda a medio cargar" } })
      fireEvent.click(screen.getByRole("button", { name: "Sumar productos existentes" }))
      await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
      expect(confirmMock.mock.calls[0][0].description).toBe(PREGUNTA)
      expect(await screen.findByTestId("elegir")).toBeInTheDocument()
    })

    it("declining keeps the form as it is and does not open the picker", async () => {
      confirmMock.mockResolvedValue(false)
      renderForm({ permiteVariantes: true })
      fireEvent.change(await screen.findByLabelText("Nombre *"), { target: { value: "Funda a medio cargar" } })
      fireEvent.click(screen.getByRole("button", { name: "Sumar productos existentes" }))
      await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
      await new Promise((r) => setTimeout(r, 50))
      expect(screen.queryByTestId("elegir")).toBeNull()
      expect(screen.getByLabelText("Nombre *")).toHaveValue("Funda a medio cargar")
    })

    it("a restored draft counts as work too", async () => {
      window.localStorage.setItem(KEY_ALTA, JSON.stringify({ version: 3, savedAt: Date.now(), data: { values: { nombre: "Borrador", categoria: "Baterías", tipoDispositivo: "CELULAR", stock: 0, precioVenta: 1 }, ui: { showStockConfig: false, showNewTipo: false, newTipo: "", showNewCategoria: false, newCategoria: "", imagenPendiente: false } } }))
      renderForm({ permiteVariantes: true })
      await screen.findByText(/se restauró un borrador no guardado/i)
      fireEvent.click(screen.getByRole("button", { name: "Sumar productos existentes" }))
      await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
    })

    it("an edited saved product asks as well", async () => {
      renderForm({ permiteVariantes: true, item: suelto })
      fireEvent.change(await screen.findByLabelText("Nombre *"), { target: { value: "Funda suelta editada" } })
      fireEvent.click(screen.getByRole("button", { name: "Sumar productos existentes" }))
      await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
    })
  })

  it("the chosen products open the grouping dialog, and the picker closes", async () => {
    renderForm({ permiteVariantes: true })
    fireEvent.click(await screen.findByRole("button", { name: "Sumar productos existentes" }))
    await screen.findByTestId("elegir")
    propsElegir.at(-1)!.onElegidos([A, B])
    expect((await screen.findByTestId("agrupar")).getAttribute("data-ids")).toBe("p1,p2")
    expect(screen.queryByTestId("elegir")).toBeNull()
  })

  it("closing the grouping dialog leaves the form as it was", async () => {
    const { container } = renderForm({ permiteVariantes: true })
    fireEvent.click(await screen.findByRole("button", { name: "Sumar productos existentes" }))
    await screen.findByTestId("elegir")
    propsElegir.at(-1)!.onElegidos([A, B])
    await screen.findByTestId("agrupar")
    propsAgrupar.at(-1)!.onClose()
    await waitFor(() => expect(screen.queryByTestId("agrupar")).toBeNull())
    expect(onSuccess).not.toHaveBeenCalled()
    expect(container.querySelector("form")).not.toBeNull()
  })

  it("after grouping, the form closes through onSuccess and its draft is gone", async () => {
    window.localStorage.setItem(KEY_ALTA, JSON.stringify({ version: 3, savedAt: Date.now(), data: { values: { nombre: "Algo", categoria: "Baterías", tipoDispositivo: "CELULAR", stock: 0, precioVenta: 1 }, ui: { showStockConfig: false, showNewTipo: false, newTipo: "", showNewCategoria: false, newCategoria: "", imagenPendiente: false } } }))
    renderForm({ permiteVariantes: true })
    fireEvent.click(await screen.findByRole("button", { name: "Sumar productos existentes" }))
    await screen.findByTestId("elegir")
    propsElegir.at(-1)!.onElegidos([A, B])
    await screen.findByTestId("agrupar")
    propsAgrupar.at(-1)!.onAgrupado()
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(window.localStorage.getItem(KEY_ALTA)).toBeNull()
  })
})
