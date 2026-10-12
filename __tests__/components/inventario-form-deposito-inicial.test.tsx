/**
 * Alta de item: el operador elige en que deposito cae el stock inicial.
 *
 * - El Select solo existe en alta y con 2+ depositos activos.
 * - Arranca en el principal (el valor por defecto NO vive en react-hook-form:
 *   se deriva, para no setear un Select montado desde un efecto asincrono).
 * - Con stock 0 no hay nada que ubicar: queda deshabilitado y no se manda.
 * - Un borrador con un deposito elegido se restaura (pasa por el guard de eco
 *   de Radix) y el valor viaja en el POST y en la consolidacion.
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

vi.mock("@/lib/image-compression", () => ({
  compressImage: async (file: File) => file,
}))

const KEY_ALTA = "draft:v3:inventario-form:org-1:user-1:new"
const NOMBRE_SELECT = /dep[oó]sito del stock inicial/i

const PRINCIPAL = { id: "dep-1", nombre: "Casa Central", principal: true, activo: true }
const TALLER = { id: "dep-2", nombre: "Deposito Taller", principal: false, activo: true }
const INACTIVO = { id: "dep-3", nombre: "Deposito Viejo", principal: false, activo: false }

const MATCH = {
  id: "existente-1",
  codigo: "CEL-0001",
  nombre: "Bateria iPhone 12",
  categoria: "Baterías",
  tipoDispositivo: "CELULAR",
  stock: 4,
  precioCompra: 100,
  precioVenta: 200,
  proveedor: null,
  score: 0.9,
}

function seedDraft(values: Record<string, unknown>) {
  window.localStorage.setItem(
    KEY_ALTA,
    JSON.stringify({
      version: 3,
      savedAt: Date.now(),
      data: {
        values: {
          nombre: "Bateria restaurada",
          categoria: "Baterías",
          tipoDispositivo: "CELULAR",
          stock: 7,
          precioVenta: 250,
          proveedorId: null,
          ubicacion: null,
          barcode: null,
          ...values,
        },
        ui: {
          showStockConfig: false,
          showNewTipo: false,
          newTipo: "",
          showNewCategoria: false,
          newCategoria: "",
          imagenPendiente: false,
        },
      },
    }),
  )
}

function renderForm(props: Partial<React.ComponentProps<typeof InventarioForm>> = {}) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <InventarioForm onClose={vi.fn()} onSuccess={vi.fn()} {...props} />
    </SWRConfig>,
  )
}

describe("InventarioForm — deposito del stock inicial", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let depositos: unknown[]

  const esPostAlta = ([u, i]: any[]) => u === "/api/inventario" && i?.method === "POST"
  const pidioDepositos = () =>
    fetchMock.mock.calls.some(([u]: any[]) => String(u).includes("/api/depositos"))

  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    depositos = [PRINCIPAL, TALLER, INACTIVO]
    fetchMock = vi.fn((url: unknown, init?: RequestInit) => {
      const href = String(url)
      if (href.includes("/api/depositos")) {
        return Promise.resolve({ ok: true, json: async () => ({ data: depositos }) } as Response)
      }
      if (href.includes("/api/inventario/next-code")) {
        return Promise.resolve({ ok: true, json: async () => ({ codigo: "CEL-0009" }) } as Response)
      }
      if (href.includes("/api/inventario/check-duplicate")) {
        return Promise.resolve({ ok: true, json: async () => ({ matches: [MATCH] }) } as Response)
      }
      if (href === "/api/inventario" && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({ id: "inv-new", codigo: "CEL-0009", nombre: "Bateria restaurada" }),
        } as Response)
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => [] } as unknown as Response)
    })
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("con 2+ depositos activos muestra el Select, por defecto en el principal", async () => {
    renderForm()
    const select = await screen.findByRole("combobox", { name: NOMBRE_SELECT })
    expect(select).toHaveTextContent("Casa Central")
  })

  it("con un solo deposito activo no muestra el Select", async () => {
    depositos = [PRINCIPAL, INACTIVO]
    renderForm()
    await waitFor(() => expect(pidioDepositos()).toBe(true))
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole("combobox", { name: NOMBRE_SELECT })).not.toBeInTheDocument()
  })

  it("en edicion no pide ni muestra depositos", async () => {
    const item = {
      id: "inv-1",
      codigo: "CEL-0001",
      nombre: "Bateria guardada",
      categoria: "Baterías",
      tipoDispositivo: "CELULAR",
      stock: 3,
      stockReservado: 0,
      precioCompra: 80,
      precioVenta: 200,
    } as Inventario
    renderForm({ item })
    await screen.findByLabelText("Nombre *")
    expect(pidioDepositos()).toBe(false)
    expect(screen.queryByRole("combobox", { name: NOMBRE_SELECT })).not.toBeInTheDocument()
  })

  it("con stock 0 queda deshabilitado", async () => {
    renderForm()
    const select = await screen.findByRole("combobox", { name: NOMBRE_SELECT })
    expect(select).toBeDisabled()
    fireEvent.change(screen.getByLabelText("Stock *"), { target: { value: "3" } })
    await waitFor(() => expect(select).not.toBeDisabled())
  })

  it("restaura el deposito de un borrador sin que el Select lo blanquee y lo manda en el POST", async () => {
    seedDraft({ depositoId: "dep-2" })
    renderForm()
    await screen.findByText(/se restauró un borrador no guardado/i)
    const select = await screen.findByRole("combobox", { name: NOMBRE_SELECT })
    await waitFor(() => expect(select).toHaveTextContent("Deposito Taller"))

    const guardar = await screen.findByRole("button", { name: "Guardar" })
    await waitFor(() => expect(guardar).not.toBeDisabled())
    fireEvent.click(guardar)

    await waitFor(() => expect(fetchMock.mock.calls.some(esPostAlta)).toBe(true))
    const post = fetchMock.mock.calls.find(esPostAlta)!
    expect(JSON.parse(post[1].body).depositoId).toBe("dep-2")
  })

  it("un borrador con un deposito que ya no existe vuelve al principal", async () => {
    seedDraft({ depositoId: "dep-borrado" })
    renderForm()
    await screen.findByText(/se restauró un borrador no guardado/i)
    const select = await screen.findByRole("combobox", { name: NOMBRE_SELECT })
    await waitFor(() => expect(select).toHaveTextContent("Casa Central"))
  })

  it("con stock 0 el POST no lleva depositoId", async () => {
    seedDraft({ depositoId: "dep-2", stock: 0 })
    renderForm()
    await screen.findByText(/se restauró un borrador no guardado/i)
    const guardar = await screen.findByRole("button", { name: "Guardar" })
    await waitFor(() => expect(guardar).not.toBeDisabled())
    fireEvent.click(guardar)

    await waitFor(() => expect(fetchMock.mock.calls.some(esPostAlta)).toBe(true))
    const post = fetchMock.mock.calls.find(esPostAlta)!
    expect(JSON.parse(post[1].body)).not.toHaveProperty("depositoId")
  })

  it("al sumar a un duplicado, el stock cae en el mismo deposito", async () => {
    confirmMock.mockResolvedValue(true)
    seedDraft({ depositoId: "dep-2" })
    renderForm()
    await screen.findByText(/se restauró un borrador no guardado/i)
    fireEvent.blur(screen.getByLabelText("Nombre *"))

    fireEvent.click(await screen.findByRole("button", { name: /sumar stock/i }))

    const esStock = ([u]: any[]) => String(u).includes("/api/inventario/existente-1/stock")
    await waitFor(() => expect(fetchMock.mock.calls.some(esStock)).toBe(true))
    const body = JSON.parse(fetchMock.mock.calls.find(esStock)![1].body)
    expect(body.referenciaTipo).toBe("CONSOLIDACION")
    expect(body.depositoId).toBe("dep-2")
  })
})
